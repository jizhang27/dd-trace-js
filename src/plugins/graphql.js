'use strict'

const shimmer = require('shimmer')

let defaultFieldResolver = null

function createWrapExecute (tracer, config) {
  return function wrapExecute (execute) {
    return function executeWithTrace () {
      const args = normalizeArgs(arguments)
      const schema = args.schema
      const fieldResolver = args.fieldResolver || defaultFieldResolver

      // console.log(args.document.definitions[0].selectionSet.selections)

      args.fieldResolver = wrapResolve(fieldResolver, tracer, config)

      if (!schema._datadog_patched) {
        wrapFields(schema._queryType._fields, tracer, config, [])
        schema._datadog_patched = true
      }

      return execute.call(this, args)
    }
  }
}

function wrapFields (fields, tracer, config) {
  Object.keys(fields).forEach(key => {
    const field = fields[key]

    if (typeof field.resolve === 'function') {
      field.resolve = wrapResolve(field.resolve, tracer, config)
    }

    if (field.type && field.type._fields) {
      wrapFields(field.type._fields, tracer, config)
    }
  })
}

function wrapResolve (resolve, tracer, config) {
  return function resolveWithTrace (source, args, contextValue, info) {
    let result

    tracer.trace('graphql.query', span => {
      span.addTags({
        'service.name': config.service || (tracer._service && `${tracer._service}-graphql`) || 'graphql',
        'resource.name': getResource(info.path).join('.')
      })

      try {
        result = resolve.apply(this, arguments)

        if (result && typeof result.then === 'function') {
          result = result
            .then(value => {
              span.finish()
              return value
            })
            .catch(err => finishAndThrow(span, err))
        } else {
          span.finish()
        }
      } catch (e) {
        finishAndThrow(span, e)
      }
    })

    return result
  }
}

function normalizeArgs (args) {
  if (args.length === 1) {
    return args[0]
  }

  return {
    schema: args[0],
    document: args[1],
    rootValue: args[2],
    contextValue: args[3],
    variableValues: args[4],
    operationName: args[5],
    fieldResolver: args[6]
  }
}

function getSelections (selectionSet) {
  // path -> span
}

function getResource (path) {
  if (path.prev) {
    return getResource(path.prev).concat(path.key)
  } else {
    return [path.key]
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
    defaultFieldResolver = execute.defaultFieldResolver
    shimmer.wrap(execute, 'execute', createWrapExecute(tracer, config))
  },
  unpatch (execute) {
    shimmer.unwrap(execute, 'execute')
    defaultFieldResolver = null
  }
}
