'use strict'

const opentracing = require('opentracing')
const Tags = opentracing.Tags
const shimmer = require('shimmer')

const OPERATION_NAME = 'graphql.query'

function createWrapGetGraphQLParams (tracer, config) {
  return function wrapGetGraphQLParams (getGraphQLParams) {
    return function getGraphQLParamsWithTrace (request) {
      console.log(request)
      return getGraphQLParams.apply(this, arguments)
    }
  }
}

function patch (graphqlHTTP, tracer, config) {
  shimmer.wrap(graphqlHTTP, 'getGraphQLParams', createWrapGetGraphQLParams(tracer, config))
}

function unpatch (graphqlHTTP) {
  shimmer.unwrap(graphqlHTTP, 'getGraphQLParams')
}

module.exports = {
  name: 'express-graphql',
  versions: ['0.6.x'],
  patch,
  unpatch
}
