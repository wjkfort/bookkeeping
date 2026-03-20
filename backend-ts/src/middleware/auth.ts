import { jwt } from "hono/jwt";
import type { Env, UserPayload } from "../types";

export const authMiddleware = (c: any, next: any) => {
  const jwtMiddleware = jwt({
    secret: c.env.JWT_SECRET,
    alg: 'HS256',
  });

  return jwtMiddleware(c, async () => {
    const payload = c.get("jwtPayload") as UserPayload;
    c.set("userId", Number(payload.sub));
    await next();
  });
};
