import pkg from "../../package.json";

export function onRequestGet() {
  return Response.json({ version: pkg.version });
}