'use strict'

const shimmer = require('shimmer')

function createWrapExecute (tracer, config) {
  return function wrapExecute (execute) {
    return function executeWithTrace (schema) {
      const fields = schema._queryType._fields

      Object.keys(fields).forEach(key => {
        const field = fields[key]

        if (fields && typeof field.resolve === 'function') {
          const resolve = field.resolve

          tracer.trace('graphql.query', span => {
            span.addTags({
              'service.name': config.service || (tracer._service && `${tracer._service}-graphql`) || 'graphql',
              'resource.name': field.name
            })

            field.resolve = tracer.bind(wrapResolve(resolve, span))
          })
        }
      })

      return execute.apply(this, arguments)
    }
  }
}

function wrapResolve (resolve, span) {
  return function resolveWithTrace () {
    try {
      const result = resolve.apply(this, arguments)

      if (result && typeof result.then === 'function') {
        return result
          .then(value => {
            span.finish()
            return value
          })
          .catch(err => finishAndThrow(span, err))
      } else {
        span.finish()
      }

      return result
    } catch (e) {
      finishAndThrow(span, e)
    }
  }
}

function finishAndThrow (span, error) {
  addError(span, error)
  span.finish()
  throw error
}

function addError (span, error) {
  if (error) {
    span.addTags({
      'error.type': error.name,
      'error.msg': error.message,
      'error.stack': error.stack
    })
  }

  return error
}

module.exports = {
  name: 'graphql',
  file: 'execution/execute.js',
  versions: ['>=0.13.0 <1.0.0'],
  patch (execute, tracer, config) {
    shimmer.wrap(execute, 'execute', createWrapExecute(tracer, config))
  },
  unpatch (execute) {
    shimmer.unwrap(execute, 'execute')
  }
}
