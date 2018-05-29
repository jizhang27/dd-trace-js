'use strict'

const shimmer = require('shimmer')
const kebabCase = require('lodash.kebabcase')

let mappings = {}

function createWrapSendOrEnqueue (tracer, config) {
  return function wrapSendOrEnqueue (sendOrEnqueue) {
    return function sendOrEnqueueWithTrace (method, fields, reply) {
      return sendOrEnqueue.call(this, method, fields, tracer.bind(reply))
    }
  }
}

function createWrapSendImmediately (tracer, config) {
  return function wrapSendImmediately (sendImmediately) {
    return function sendImmediatelyWithTrace (method, fields) {
      return sendWithTrace(sendImmediately, this, arguments, tracer, config, mappings[method], fields)
    }
  }
}

function createWrapSendMessage (tracer, config) {
  return function wrapSendMessage (sendMessage) {
    return function sendMessageWithTrace (fields) {
      return sendWithTrace(sendMessage, this, arguments, tracer, config, 'basic.publish', fields)
    }
  }
}

function createWrapDispatchMessage (tracer, config) {
  return function wrapDispatchMessage (dispatchMessage) {
    return function dispatchMessageWithTrace (fields, message) {
      let returnValue

      tracer.trace('amqp.command', span => {
        addTags(this, config, span, 'basic.deliver', fields)

        try {
          returnValue = dispatchMessage.apply(this, arguments)
        } catch (e) {
          throw addError(span, e)
        }
      })

      return returnValue
    }
  }
}

function sendWithTrace (send, channel, args, tracer, config, method, fields) {
  let span

  tracer.trace('amqp.command', child => {
    span = child
  })

  addTags(channel, config, span, method, fields)

  try {
    return send.apply(channel, args)
  } catch (e) {
    throw addError(span, e)
  } finally {
    span.finish()
  }
}

function isCamelCase (str) {
  return /([A-Z][a-z0-9]+)+/.test(str)
}

function getResourceName (method, fields) {
  return method
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

function addTags (channel, config, span, method, fields) {
  const fieldNames = [
    'queue',
    'exchange',
    'routingKey',
    'consumerTag',
    'source',
    'destination'
  ]

  span.addTags({
    'service.name': config.service || 'amqp',
    'resource.name': getResourceName(method, fields),
    'span.type': 'worker',
    'out.host': channel.connection.stream._host,
    'out.port': channel.connection.stream.remotePort
  })

  switch (method) {
    case 'basic.publish':
      span.setTag('span.kind', 'producer')
      break
    case 'basic.consume':
    case 'basic.get':
    case 'basic.deliver':
      span.setTag('span.kind', 'consumer')
      break
  }

  fieldNames.forEach(field => {
    fields[field] !== undefined && span.setTag(`amqp.${field}`, fields[field])
  })
}

module.exports = [
  {
    name: 'amqplib',
    file: 'lib/defs.js',
    versions: ['0.5.x'],
    patch (defs, tracer, config) {
      mappings = Object.keys(defs)
        .filter(key => Number.isInteger(defs[key]))
        .filter(key => isCamelCase(key))
        .reduce((acc, key) => Object.assign(acc, { [defs[key]]: kebabCase(key).replace('-', '.') }), {})
    },
    unpatch (defs) {
      mappings = {}
    }
  },
  {
    name: 'amqplib',
    file: 'lib/channel.js',
    versions: ['0.5.x'],
    patch (channel, tracer, config) {
      shimmer.wrap(channel.Channel.prototype, 'sendOrEnqueue', createWrapSendOrEnqueue(tracer, config))
      shimmer.wrap(channel.Channel.prototype, 'sendImmediately', createWrapSendImmediately(tracer, config))
      shimmer.wrap(channel.Channel.prototype, 'sendMessage', createWrapSendMessage(tracer, config))
      shimmer.wrap(channel.BaseChannel.prototype, 'dispatchMessage', createWrapDispatchMessage(tracer, config))
    },
    unpatch (channel) {
      shimmer.unwrap(channel.Channel.prototype, 'sendOrEnqueue')
      shimmer.unwrap(channel.Channel.prototype, 'sendImmediately')
      shimmer.unwrap(channel.Channel.prototype, 'sendMessage')
      shimmer.unwrap(channel.BaseChannel.prototype, 'dispatchMessage')
    }
  }
]
