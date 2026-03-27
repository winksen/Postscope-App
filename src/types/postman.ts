export interface PostmanVariable {
  key: string;
  value?: string;
  type?: string;
}

export interface PostmanAuth {
  type?: string;
  bearer?: Array<{ key: string; value: string }>;
  basic?: Array<{ key: string; value: string }>;
  aws?: unknown;
  oauth1?: unknown;
  oauth2?: unknown;
}

export interface PostmanHeader {
  key: string;
  value: string;
  disabled?: boolean;
}

export interface PostmanBody {
  mode?: string;
  raw?: string;
  urlencoded?: Array<{ key: string; value: string }>;
  formdata?: unknown;
}

export interface PostmanUrl {
  raw?: string;
  protocol?: string;
  host?: string[] | string;
  path?: string[];
  query?: Array<{ key: string; value: string }>;
}

export interface PostmanRequest {
  name: string;
  request?: {
    method?: string;
    header?: PostmanHeader[];
    body?: PostmanBody;
    url?: string | PostmanUrl;
    auth?: PostmanAuth;
    description?: string;
  };
  response?: unknown[];
}

export interface PostmanItem {
  name: string;
  item?: PostmanItem[];
  request?: PostmanRequest['request'];
  response?: unknown[];
  description?: string;
}

export interface PostmanCollection {
  info: {
    name: string;
    _postman_id?: string;
    description?: string;
    schema: string;
  };
  item: PostmanItem[];
  variable?: PostmanVariable[];
  auth?: PostmanAuth;
}
