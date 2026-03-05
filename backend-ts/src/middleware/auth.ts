import { jwt } from "hono/jwt";
import type { Env } from "../types";

export const authMiddleware = (c: any, next: any) => {
  const jwtMiddleware = jwt({
    secret: c.env.JWT_SECRET,
    alg: 'HS256',
  });
  return jwtMiddleware(c, next);
};
