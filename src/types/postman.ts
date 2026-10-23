export interface PostmanVariable {
  key: string
  value?: string
  type?: string
  disabled?: boolean
}

export interface PostmanKeyValue {
  key: string
  value: string
  disabled?: boolean
  type?: string
}

export interface PostmanAuth {
  type?: string
  bearer?: Array<{ key: string; value: string }>
  basic?: Array<{ key: string; value: string }>
  apikey?: unknown
  aws?: unknown
  oauth1?: unknown
  oauth2?: unknown
  [scheme: string]: unknown
}

export interface PostmanHeader {
  key: string
  value: string
  disabled?: boolean
}

export interface PostmanBody {
  mode?: string
  raw?: string
  urlencoded?: Array<{ key: string; value: string; disabled?: boolean; type?: string }>
  formdata?: unknown
  graphql?: {
    query?: string
    variables?: string
  }
}

export interface PostmanUrl {
  raw?: string
  protocol?: string
  host?: string[] | string
  path?: Array<string | { value?: string }> | string
  query?: Array<{ key: string; value: string; disabled?: boolean }>
  /** Path variables (`:id` segments). */
  variable?: Array<{ key: string; value?: string; description?: string }>
}

export interface PostmanScript {
  exec?: string[] | string
  type?: string
}

export interface PostmanEvent {
  listen?: string
  script?: PostmanScript
  disabled?: boolean
}

export interface PostmanResponse {
  name?: string
  originalRequest?: PostmanRequest['request']
  header?: PostmanHeader[] | string
  body?: string
  code?: number
  status?: string
}

export interface PostmanRequest {
  name: string
  request?: {
    method?: string
    header?: PostmanHeader[]
    body?: PostmanBody
    url?: string | PostmanUrl
    auth?: PostmanAuth
    description?: string
  }
  response?: unknown[]
}

export interface PostmanItem {
  name: string
  item?: PostmanItem[]
  request?: PostmanRequest['request']
  response?: unknown[]
  description?: string
  auth?: PostmanAuth
  event?: PostmanEvent[]
  /** Folder or request level variables. */
  variable?: PostmanVariable[]
  protocolProfileBehavior?: Record<string, unknown>
}

export interface PostmanCollection {
  info: {
    name: string
    _postman_id?: string
    description?: string
    schema: string
  }
  item: PostmanItem[]
  variable?: PostmanVariable[]
  auth?: PostmanAuth
  event?: PostmanEvent[]
  protocolProfileBehavior?: Record<string, unknown>
}
