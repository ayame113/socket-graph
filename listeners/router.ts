import type { Status } from "https://deno.land/std@0.134.0/http/mod.ts";
import { Router } from "../static/utils/router.ts";
import type { html } from "../static/utils/domtag.ts";

type PromiseOrValue<T> = T | Promise<T>;

export type Extension = `.${string}`;
type RouterArg = {
  StringHandlerArg: {
    request: Readonly<Request>;
    url: Readonly<URL>;
  };
  PatternHandlerArg: {
    request: Readonly<Request>;
    url: Readonly<URL>;
    match: URLPatternResult;
  };
};
export type RouterResult = PromiseOrValue<
  {
    body: BodyInit | ReturnType<typeof html>;
    status?: Status;
    contentType?: string;
    type?: Extension;
    cors?: boolean;
  } | {
    body?: BodyInit | ReturnType<typeof html>;
    status: Status;
    contentType?: string;
    type?: Extension;
    cors?: boolean;
  }
>;

type WebSocketRouterArg = {
  StringHandlerArg: {
    request: Readonly<Request>;
    url: Readonly<URL>;
    socket: WebSocket;
  };
  PatternHandlerArg: {
    request: Readonly<Request>;
    url: Readonly<URL>;
    socket: WebSocket;
    match: URLPatternResult;
  };
};

export const router = {
  /** GETメゾット用のルーター */
  GET: new Router<RouterArg, RouterResult>(),
  /** POSTメゾット用のルーター */
  POST: new Router<RouterArg, RouterResult>(),
  /** DELETEメゾット用のルーター */
  DELETE: new Router<RouterArg, RouterResult>(),
};

export const socketRouter = new Router<
  WebSocketRouterArg,
  PromiseOrValue<void>
>();
