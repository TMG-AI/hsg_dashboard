import { Redis } from "@upstash/redis";
const r = new Redis({ url: process.env.STORAGE_KV_REST_API_URL, token: process.env.STORAGE_KV_REST_API_TOKEN });
export default async function handler(req, res) {
  await Promise.all([r.del("mentions:z"), r.del("mentions:seen")]);
  res.status(200).json({ ok:true });
}
