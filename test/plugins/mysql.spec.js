'use strict'

const agent = require('./agent')

describe('Plugin', () => {
  let plugin
  let mysql
  let context

  describe('mysql', () => {
    beforeEach(() => {
      mysql = require('mysql')
      plugin = require('../../src/plugins/mysql')
      context = require('../../src/platform').context({ experimental: { asyncHooks: false } })
    })

    afterEach(() => {
      agent.close()
    })

    describe('without configuration', () => {
      let connection

      beforeEach(() => {
        return agent.load(plugin, 'mysql')
          .then(() => {
            mysql = require('mysql')

            connection = mysql.createConnection({
              host: 'localhost',
              user: 'user',
              password: 'userpass',
              database: 'db'
            })

            connection.connect()
          })
      })

      afterEach(done => {
        connection.end(done)
      })

      it('should propagate context to callbacks', done => {
        context.run(() => {
          context.set('foo', 'bar')
          connection.query('SELECT 1 + 1 AS solution', callback)
        })

        function callback () {
          expect(context.get('foo')).to.equal('bar')
          done()
        }
      })

      it('should run the callback in the parent context', done => {
        connection.query('SELECT 1 + 1 AS solution', () => {
          expect(context.get('current')).to.be.undefined
          done()
        })
      })

      it('should propagate context to events', done => {
        let query

        context.run(() => {
          context.set('foo', 'bar')
          query = connection.query('SELECT 1 + 1 AS solution')
          query.on('result', callback)
        })

        function callback () {
          expect(context.get('foo')).to.equal('bar')
          done()
        }
      })

      it('should run event listeners in the parent context', done => {
        const query = connection.query('SELECT 1 + 1 AS solution')

        query.on('result', () => {
          expect(context.get('current')).to.be.undefined
          done()
        })
      })

      it('should do automatic instrumentation', done => {
        agent.use(traces => {
          expect(traces[0][0]).to.have.property('service', 'mysql')
          expect(traces[0][0]).to.have.property('resource', 'SELECT 1 + 1 AS solution')
          expect(traces[0][0]).to.have.property('type', 'db')
          expect(traces[0][0].meta).to.have.property('db.name', 'db')
          expect(traces[0][0].meta).to.have.property('db.user', 'user')
          expect(traces[0][0].meta).to.have.property('db.type', 'mysql')
          expect(traces[0][0].meta).to.have.property('span.kind', 'client')

          done()
        })

        connection.query('SELECT 1 + 1 AS solution', (error, results, fields) => {
          if (error) throw error
        })
      })

      it('should handle errors', done => {
        let error

        agent.use(traces => {
          expect(traces[0][0].meta).to.have.property('error.type', error.name)
          expect(traces[0][0].meta).to.have.property('error.msg', error.message)
          expect(traces[0][0].meta).to.have.property('error.stack', error.stack)

          done()
        })

        connection.query('INVALID', (err, results, fields) => {
          error = err
          expect(error).to.be.an('error')
        })
      })

      it('should work without a callback', done => {
        agent.use(traces => {
          done()
        })

        connection.query('SELECT 1 + 1 AS solution')
      })
    })

    describe('with configuration', () => {
      let connection
      let config

      beforeEach(() => {
        config = {
          service: 'custom'
        }

        return agent.load(plugin, 'mysql', config)
          .then(() => {
            mysql = require('mysql')

            connection = mysql.createConnection({
              host: 'localhost',
              user: 'user',
              password: 'userpass',
              database: 'db'
            })

            connection.connect()
          })
      })

      afterEach(done => {
        connection.end(done)
      })

      it('should be configured with the correct values', done => {
        agent.use(traces => {
          expect(traces[0][0]).to.have.property('service', 'custom')
          done()
        })

        connection.query('SELECT 1 + 1 AS solution')
      })
    })

    describe('with a connection pool', () => {
      let pool

      beforeEach(() => {
        return agent.load(plugin, 'mysql')
          .then(() => {
            mysql = require('mysql')

            pool = mysql.createPool({
              connectionLimit: 10,
              host: 'localhost',
              user: 'user',
              password: 'userpass'
            })
          })
      })

      afterEach(done => {
        pool.end(done)
      })

      it('should do automatic instrumentation', done => {
        agent.use(traces => {
          expect(traces[0][0]).to.have.property('service', 'mysql')
          expect(traces[0][0]).to.have.property('resource', 'SELECT 1 + 1 AS solution')
          expect(traces[0][0]).to.have.property('type', 'db')
          expect(traces[0][0].meta).to.have.property('db.user', 'user')
          expect(traces[0][0].meta).to.have.property('db.type', 'mysql')
          expect(traces[0][0].meta).to.have.property('span.kind', 'client')

          done()
        })

        pool.query('SELECT 1 + 1 AS solution')
      })

      it('should propagate context', done => {
        context.run(() => {
          context.set('foo', 'bar')
          pool.query('SELECT 1 + 1 AS solution', callback)
        })

        function callback () {
          expect(context.get('foo')).to.equal('bar')
          done()
        }
      })

      it('should run the callback in the parent context', done => {
        pool.query('SELECT 1 + 1 AS solution', () => {
          expect(context.get('current')).to.be.undefined
          done()
        })
      })
    })
  })
})
