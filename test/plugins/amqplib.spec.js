'use strict'

const agent = require('./agent')

describe('Plugin', () => {
  let plugin
  let context
  let connection
  let channel

  describe('amqplib', () => {
    beforeEach(() => {
      plugin = require('../../src/plugins/amqplib')
      context = require('../../src/platform').context({ experimental: { asyncHooks: false } })
    })

    afterEach(() => {
      agent.close()
      connection.close()
    })

    describe('without configuration', () => {
      describe('when using a callback', () => {
        beforeEach(done => {
          agent.load(plugin, 'amqplib')
            .then(() => {
              require('amqplib/callback_api')
                .connect((err, conn) => {
                  connection = conn

                  if (err != null) {
                    return done(err)
                  }

                  conn.createChannel((err, ch) => {
                    channel = ch
                    done(err)
                  })
                })
            })
            .catch(done)
        })

        describe('when sending commands', () => {
          it('should do automatic instrumentation for immediate commands', done => {
            agent
              .use(traces => {
                const span = traces[0][0]

                expect(span).to.have.property('name', 'amqp.command')
                expect(span).to.have.property('service', 'amqp')
                expect(span).to.have.property('resource', 'queue.declare')
                expect(span).to.have.property('type', 'worker')
                expect(span.meta).to.have.property('out.host', 'localhost')
                expect(span.meta).to.have.property('out.port', '5672')
              }, 2)
              .then(done)
              .catch(done)

            channel.assertQueue('test', {}, err => err && done(err))
          })

          it('should do automatic instrumentation for queued commands', done => {
            agent
              .use(traces => {
                const span = traces[0][0]

                expect(span).to.have.property('name', 'amqp.command')
                expect(span).to.have.property('service', 'amqp')
                expect(span).to.have.property('resource', 'queue.delete')
                expect(span).to.have.property('type', 'worker')
                expect(span.meta).to.have.property('out.host', 'localhost')
                expect(span.meta).to.have.property('out.port', '5672')
              }, 3)
              .then(done)
              .catch(done)

            channel.assertQueue('test', {}, err => err && done(err))
            channel.deleteQueue('test', err => err && done(err))
          })

          it('should handle errors', done => {
            let error

            agent
              .use(traces => {
                const span = traces[0][0]

                expect(span).to.have.property('error', 1)
                expect(span.meta).to.have.property('error.type', error.name)
                expect(span.meta).to.have.property('error.msg', error.message)
                expect(span.meta).to.have.property('error.stack', error.stack)
              }, 2)
              .then(done)
              .catch(done)

            try {
              channel.deleteQueue(null, () => {})
            } catch (e) {
              error = e
            }
          })
        })

        describe('when publishing messages', () => {
          it('should do automatic instrumentation', done => {
            agent
              .use(traces => {
                const span = traces[0][0]

                expect(span).to.have.property('name', 'amqp.command')
                expect(span).to.have.property('service', 'amqp')
                expect(span).to.have.property('resource', 'basic.publish')
                expect(span).to.have.property('type', 'worker')
                expect(span.meta).to.have.property('out.host', 'localhost')
                expect(span.meta).to.have.property('out.port', '5672')
                expect(span.meta).to.have.property('span.kind', 'producer')
                expect(span.meta).to.have.property('amqp.routingKey', 'test')
              }, 2)
              .then(done)
              .catch(done)

            channel.sendToQueue('test', Buffer.from('content'))
          })

          it('should handle errors', done => {
            let error

            agent
              .use(traces => {
                const span = traces[0][0]

                expect(span).to.have.property('error', 1)
                expect(span.meta).to.have.property('error.type', error.name)
                expect(span.meta).to.have.property('error.msg', error.message)
                expect(span.meta).to.have.property('error.stack', error.stack)
              }, 2)
              .then(done)
              .catch(done)

            try {
              channel.sendToQueue('test', 'invalid')
            } catch (e) {
              error = e
            }
          })
        })

        describe('when consuming messages', () => {
          it('should do automatic instrumentation', done => {
            let consumerTag

            agent
              .use(traces => {
                const span = traces[0][0]

                expect(span).to.have.property('name', 'amqp.command')
                expect(span).to.have.property('service', 'amqp')
                expect(span).to.have.property('resource', 'basic.deliver')
                expect(span).to.have.property('type', 'worker')
                expect(span.meta).to.have.property('out.host', 'localhost')
                expect(span.meta).to.have.property('out.port', '5672')
                expect(span.meta).to.have.property('span.kind', 'consumer')
                expect(span.meta).to.have.property('amqp.consumerTag', consumerTag)
              }, 5)
              .then(done)
              .catch(done)

            channel.assertQueue('', {}, (err, ok) => {
              if (err) return done(err)

              channel.sendToQueue(ok.queue, Buffer.from('content'))
              channel.consume(ok.queue, () => {
                context.get('current').finish()
              }, {}, (err, ok) => {
                if (err) return done(err)
                consumerTag = ok.consumerTag
              })
            })
          })

          it('should run the command callback in the parent context', done => {
            context.run(() => {
              context.set('foo', 'bar')

              channel.assertQueue('', {}, (err, ok) => {
                if (err) return done(err)

                channel.consume(ok.queue, () => {}, {}, () => {
                  expect(context.get('current')).to.be.undefined
                  expect(context.get('foo')).to.equal('bar')
                  done()
                })
              })
            })
          })

          it('should run the delivery callback in the current context', done => {
            channel.assertQueue('', {}, (err, ok) => {
              if (err) return done(err)

              channel.sendToQueue(ok.queue, Buffer.from('content'))
              channel.consume(ok.queue, () => {
                expect(context.get('current')).to.not.be.undefined
                done()
              }, {}, err => err && done(err))
            })
          })
        })
      })

      describe('when using a promise', () => {
        beforeEach(() => {
          return agent.load(plugin, 'amqplib')
            .then(() => require('amqplib').connect())
            .then(conn => (connection = conn))
            .then(conn => conn.createChannel())
            .then(ch => (channel = ch))
        })

        it('should run the callback in the parent context', done => {
          context.run(() => {
            context.set('foo', 'bar')

            channel.assertQueue('test', {})
              .then(() => {
                expect(context.get('current')).to.be.undefined
                expect(context.get('foo')).to.equal('bar')
                done()
              })
              .catch(done)
          })
        })
      })
    })

    describe('with configuration', () => {
      beforeEach(done => {
        agent.load(plugin, 'amqplib', { service: 'test' })
          .then(() => {
            require('amqplib/callback_api')
              .connect((err, conn) => {
                connection = conn

                if (err !== null) {
                  return done(err)
                }

                conn.createChannel((err, ch) => {
                  channel = ch
                  done(err)
                })
              })
          })
          .catch(done)
      })

      it('should be configured with the correct values', done => {
        agent
          .use(traces => {
            expect(traces[0][0]).to.have.property('service', 'test')
            expect(traces[0][0]).to.have.property('resource', 'queue.declare')
          }, 2)
          .then(done)
          .catch(done)

        channel.assertQueue('test', {}, err => err && done(err))
      })
    })
  })
})
