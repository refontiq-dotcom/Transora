import type { VercelRequest, VercelResponse } from '@vercel/node';
import app from '../src/app';

export default function handler(req: VercelRequest, res: VercelResponse) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  // Create mock req/res for Express
  const expressReq = Object.assign(req, {
    originalUrl: req.url,
    url: req.url,
    headers: { ...req.headers },
    method: req.method,
    body: req.body,
    query: req.query,
    cookies: req.cookies || {},
  });
  
  const expressRes = Object.assign(res, {
    status: (code: number) => {
      res.status(code);
      return expressRes;
    },
    json: (data: any) => {
      res.json(data);
    },
    send: (data: any) => {
      res.send(data);
    },
    end: () => {
      res.end();
    },
    setHeader: (name: string, value: any) => {
      res.setHeader(name, value);
    },
    getHeader: (name: string) => {
      return res.getHeader(name);
    },
    appendHeader: (name: string, value: string) => {
      res.setHeader(name, `${res.getHeader(name) || ''}, ${value}`);
    },
    cookie: (name: string, value: string) => {
      res.setHeader('Set-Cookie', name + '=' + value);
    },
    clearCookie: (name: string) => {
      res.setHeader('Set-Cookie', name + '=; Max-Age=0');
    },
  });
  
  app(expressReq as any, expressRes as any);
}
