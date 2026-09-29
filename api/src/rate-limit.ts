import { redis } from './queue.js';
import { config } from './config.js';

// One atomic Redis operation reserves both the hourly quota and sender's next send slot.
// Reservations are shared by every worker process; there are no process-local counters.
const reserveScript = `
local now = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local gap = tonumber(ARGV[3])
local nextAt = tonumber(redis.call('GET', KEYS[2]) or '0')
local candidate = math.max(now, nextAt)
local window = math.floor(candidate / 3600000)
local countKey = KEYS[1] .. ':' .. window
local count = tonumber(redis.call('GET', countKey) or '0')
if count >= limit then
  return {0, (window + 1) * 3600000, count, window}
end
local sendAt = candidate
redis.call('INCR', countKey)
redis.call('PEXPIRE', countKey, 7200000)
redis.call('SET', KEYS[2], sendAt + gap, 'PX', 7200000)
return {1, sendAt, count + 1, window}
`;

export async function reserveSenderSlot(senderId: string, limit = config.hourlyLimit, now = Date.now()) {
  const result = await redis.eval(reserveScript, 2, `mail:hour:${senderId}`, `mail:next:${senderId}`,
    now, limit, config.minSendGapMs) as [number, number, number, number];
  return { allowed: result[0] === 1, sendAt: result[1], count: result[2], window: result[3] };
}
