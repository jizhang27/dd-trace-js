'use strict'

const axios = require('axios')
const getPort = require('get-port')
const agent = require('./agent')

describe('Plugin', () => {
  let plugin
  let context
  let graphql

  describe('express', () => {
    beforeEach(() => {
      plugin = require('../../src/plugins/graphql')
      graphql = require('graphql')
      context = require('../../src/platform').context({ experimental: { asyncHooks: false } })
    })

    afterEach(() => {
      agent.close()
    })

    describe('without configuration', () => {
      beforeEach(() => {
        return agent.load(plugin, 'graphql')
      })

      it('should do automatic instrumentation on schema resolvers', done => {
        // const schema = graphql.buildSchema(`
        //   type Query {
        //     hello: String
        //     human(id: ID!): Human
        //   }

        //   type Human {
        //     name: String
        //   }
        // `)

        const schema = new graphql.GraphQLSchema({
          query: new graphql.GraphQLObjectType({
            name: 'RootQueryType',
            fields: {
              hello: {
                type: graphql.GraphQLString,
                resolve () {
                  return 'world'
                }
              }
            }
          })
        })

        // console.log(schema._queryType._fields)

        // const result = resolveField(
        //   exeContext,
        //   parentType,
        //   sourceValue,
        //   fieldNodes,
        //   fieldPath,
        // );

        const query = `{ hello }`
        // const query = `{ human(id: 1002) { name } }`

        const rootValue = {
          // hello: (obj, args, context) => {
          //   // console.log(obj, args, context)
          //   return 'Hello world!'
          // },
          human: {
            resolve: () => {}
          }
        }

        agent
          .use(traces => {
            expect(traces[0][0]).to.have.property('service', 'test-graphql')
            // expect(traces[0][0]).to.have.property('type', 'web')
            expect(traces[0][0]).to.have.property('resource', 'hello')
          })
          .then(done)
          .catch(done)

        graphql.graphql(schema, query, rootValue).catch(done)
      })
    })
  })
})
