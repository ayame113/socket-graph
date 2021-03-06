import { serve, STATUS_TEXT } from "https://deno.land/std@0.134.0/http/mod.ts";
import { extname } from "https://deno.land/std@0.134.0/path/mod.ts";
import { contentType } from "https://deno.land/x/media_types@v3.0.2/mod.ts";
import { transform } from "https://deno.land/x/swc@0.1.4/mod.ts";

import "./listeners/mod.ts";
import { router, socketRouter } from "./listeners/router.ts";
import type { Extension, RouterResult } from "./listeners/router.ts";
import { DomTag } from "./static/utils/domtag.ts";

import AllowCORS from "./allow_cors.json" assert { type: "json" };
const AllowCORSSet = new Set(AllowCORS);

function contentTypeFromPath(path: string) {
  return contentType(extname(path) ?? ".txt") ?? "text/plain; charset=utf-8";
}
function contentTypeFromExt(extension?: Extension) {
  return contentType(extension ?? ".txt") ?? "text/plain; charset=utf-8";
}

async function createResponse(src: RouterResult) {
  let { body, status, contentType, type, cors } = await src;
  body = body instanceof DomTag ? body.toString() : body;
  body ||= `${status} ${STATUS_TEXT.get(status ?? 200)}`;
  contentType ||= contentTypeFromExt(type);
  const corsHeader: HeadersInit = cors
    ? { "Access-Control-Allow-Origin": "*" }
    : {};
  return new Response(body, {
    status,
    headers: { "Content-Type": contentType, ...corsHeader },
  });
}

export function tsToJs(content: string) {
  return transform(content, {
    // minify: true,
    jsc: {
      target: "es2021",
      parser: {
        syntax: "typescript",
      },
    },
    // deno-lint-ignore no-explicit-any
  } as any).code;
}

async function handleHttpRequest(request: Request) {
  try {
    const url = new URL(request.url);
    if (request.method === "GET") {
      try {
        let { pathname } = url;
        if (pathname.at(-1) === "/") {
          pathname += "index.html";
        }
        const response = await fetch(
          new URL(`./static${pathname}`, import.meta.url),
        );
        const corsHeader: HeadersInit = AllowCORSSet.has(pathname)
          ? { "Access-Control-Allow-Origin": "*" }
          : {};
        try {
          if (extname(pathname) === ".ts") {
            return new Response(tsToJs(await response.text()), {
              headers: {
                "Content-Type": contentTypeFromExt(".js"),
                ...corsHeader,
              },
            });
          } else {
            return new Response(response.body, {
              headers: {
                "Content-Type": contentTypeFromPath(pathname),
                ...corsHeader,
              },
            });
          }
        } catch (error) {
          console.error(pathname, error);
          return createResponse({ status: 500 });
        }
      } catch (error) {
        if (
          // TODO: remove not ound error
          !(error instanceof TypeError || error instanceof Deno.errors.NotFound)
        ) {
          console.error(url.pathname, error);
          return createResponse({ status: 500 });
        }
      }
    }
    if (router[request.method as keyof typeof router]) {
      const routed = router[request.method as keyof typeof router].get(url);
      if (routed.handler) {
        if (!routed.match) {
          return createResponse(routed.handler({ request, url }));
        }
        return createResponse(
          routed.handler({ request, url, match: routed.match }),
        );
      }
    }
    return createResponse({ status: 404 });
  } catch (error) {
    console.error(request.url, error);
    return createResponse({ status: 500 });
  }
}

async function handleWebSocketRequst(request: Request) {
  try {
    const url = new URL(request.url);
    const { socket, response } = Deno.upgradeWebSocket(request);
    const routed = socketRouter.get(url);
    if (routed.handler) {
      if (!routed.match) {
        await routed.handler({ request, url, socket });
        return response;
      }
      await routed.handler({ request, url, socket, match: routed.match });
      return response;
    }
    return createResponse({ status: 404 });
  } catch (error) {
    console.error(request.url, error);
    return createResponse({ status: 500 });
  }
}

// export for test
export function startServer() {
  const controller = new AbortController();
  const server = serve((request) => {
    if (
      request.method === "GET" &&
      request.headers.get("Upgrade")?.toLowerCase() === "websocket" &&
      request.headers.get("Connection")?.toLowerCase() === "upgrade"
    ) {
      return handleWebSocketRequst(request);
    }
    return handleHttpRequest(request);
  }, controller);

  return { server, controller };
}

if (import.meta.main) {
  startServer();
  console.log("http://localhost:8000/");
}
