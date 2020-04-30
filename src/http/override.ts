import http, { ClientRequest } from 'http'
import https from 'https'
import { ModuleOverride, RequestMiddleware } from '../glossary'
import { createClientRequestOverrideClass } from './ClientRequest/ClientRequestOverride'

const debug = require('debug')('http:override')

let originalClientRequest: typeof ClientRequest
let patchedModules: Record<
  string,
  {
    module: any
    request: typeof http['request']
    get: typeof http['get']
  }
> = {}

function handleRequest(
  protocol: string,
  originalMethod: any,
  middleware: RequestMiddleware,
  args: any[]
): ClientRequest {
  if (!originalClientRequest) {
    const ClientRequestOverride = createClientRequestOverrideClass(
      middleware,
      originalMethod,
      originalClientRequest
    )

    debug('patching native http.ClientRequest')

    // @ts-ignore
    http.ClientRequest = ClientRequestOverride
  }

  debug('constructing http.ClientRequest (origin: %s)', protocol)

  // @ts-ignore
  return new http.ClientRequest(...args)
}

export const overrideHttpModule: ModuleOverride = (middleware) => {
  const modules: ['http', 'https'] = ['http', 'https']

  modules.forEach((protocol) => {
    const module = ({
      http: require('http'),
      https: require('https'),
    } as Record<string, typeof http | typeof https>)[protocol]

    const { request: originalRequest, get: originalGet } = module

    function proxiedOriginalRequest(...args: any[]) {
      debug('%s.request original call', protocol)
      // @ts-ignore
      return originalRequest(...args)
    }

    debug('patching "%s" module', protocol)

    // @ts-ignore
    module.request = function requestOverride(...args: any[]) {
      debug('%s.request proxy call', protocol)

      return handleRequest(
        protocol,
        proxiedOriginalRequest.bind(module),
        middleware,
        args
      )
    }

    // @ts-ignore
    module.get = function getOverride(...args: any[]) {
      debug('%s.get call', protocol)

      const req = handleRequest(
        protocol,
        originalGet.bind(module),
        middleware,
        args
      )
      req.end()

      return req
    }

    patchedModules[protocol] = {
      module,
      request: originalRequest,
      get: originalGet,
    }
  })

  return () => {
    debug('reverting patches...')

    Object.values(patchedModules).forEach(({ module, request, get }) => {
      module.request = request
      module.get = get
    })

    patchedModules = {}
  }
}
