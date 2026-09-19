import { createHash, createHmac, randomBytes } from "node:crypto";

import type { CognitoConfig } from "./cognito-config";

const N_HEX =
  "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1" +
  "29024E088A67CC74020BBEA63B139B22514A08798E3404DD" +
  "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245" +
  "E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED" +
  "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D" +
  "C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F" +
  "83655D23DCA3AD961C62F356208552BB9ED529077096966D" +
  "670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B" +
  "E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9" +
  "DE2BCBF6955817183995497CEA956AE515D2261898FA0510" +
  "15728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64" +
  "ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7" +
  "ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6B" +
  "F12FFA06D98A0864D87602733EC86A64521F2B18177B200C" +
  "BBE117577A615D6C770988C0BAD946E208E24FA074E5AB31" +
  "43DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF";

const N = BigInt(`0x${N_HEX}`);
const G = BigInt(2);
const INFO_BITS = Buffer.from("Caldera Derived Key", "utf8");
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function secretHash(
  cfg: CognitoConfig,
  username: string,
): string {
  return createHmac("sha256", cfg.clientSecret)
    .update(`${username}${cfg.clientId}`)
    .digest("base64");
}

export function createSrpSession(
  cfg: CognitoConfig,
  username: string,
  password: string,
) {
  const smallA = randomSrpA();
  const largeA = modPow(G, smallA, N);
  if (largeA % N === BigInt(0)) {
    throw new Error("SRP safety check for A failed");
  }
  const k = BigInt(`0x${hexHash(`00${N_HEX}0${G.toString(16)}`)}`);
  const poolName = cfg.userPoolId.split("_")[1] || cfg.userPoolId;

  return {
    authParameters(): Record<string, string> {
      return {
        USERNAME: username,
        SRP_A: largeA.toString(16),
        SECRET_HASH: secretHash(cfg, username),
      };
    },
    passwordVerifier(
      challenge: Record<string, string>,
    ): Record<string, string> {
      const internalUsername = challenge.USERNAME || username;
      const userIdForSrp = challenge.USER_ID_FOR_SRP || internalUsername;
      const saltHex = challenge.SALT;
      const srpB = BigInt(`0x${challenge.SRP_B}`);
      const secretBlock = challenge.SECRET_BLOCK;
      const hkdf = passwordAuthenticationKey({
        poolName,
        userIdForSrp,
        password,
        largeA,
        smallA,
        srpB,
        saltHex,
        k,
      });
      const timestamp = cognitoTimestamp();
      const message = Buffer.concat([
        Buffer.from(poolName, "utf8"),
        Buffer.from(userIdForSrp, "utf8"),
        Buffer.from(secretBlock, "base64"),
        Buffer.from(timestamp, "utf8"),
      ]);
      const signature = createHmac("sha256", hkdf).update(message).digest("base64");
      return {
        TIMESTAMP: timestamp,
        USERNAME: internalUsername,
        PASSWORD_CLAIM_SECRET_BLOCK: secretBlock,
        PASSWORD_CLAIM_SIGNATURE: signature,
        SECRET_HASH: secretHash(cfg, internalUsername),
      };
    },
  };
}

function passwordAuthenticationKey(input: {
  poolName: string;
  userIdForSrp: string;
  password: string;
  largeA: bigint;
  smallA: bigint;
  srpB: bigint;
  saltHex: string;
  k: bigint;
}): Buffer {
  const u = BigInt(`0x${hexHash(padHex(input.largeA) + padHex(input.srpB))}`);
  if (u === BigInt(0)) throw new Error("SRP U cannot be zero");
  const usernamePassword = `${input.poolName}${input.userIdForSrp}:${input.password}`;
  const usernamePasswordHash = sha256Hex(Buffer.from(usernamePassword, "utf8"));
  const x = BigInt(`0x${hexHash(padHex(input.saltHex) + usernamePasswordHash)}`);
  const gModPowXn = modPow(G, x, N);
  const intValue2 = input.srpB - input.k * gModPowXn;
  const s = modPow(mod(intValue2, N), input.smallA + u * x, N);
  return computeHkdf(hexToBuf(padHex(s)), hexToBuf(padHex(u.toString(16))));
}

function randomSrpA(): bigint {
  return mod(BigInt(`0x${randomBytes(128).toString("hex")}`), N);
}

function computeHkdf(ikm: Buffer, salt: Buffer): Buffer {
  const prk = createHmac("sha256", salt).update(ikm).digest();
  const info = Buffer.concat([INFO_BITS, Buffer.from([1])]);
  return createHmac("sha256", prk).update(info).digest().subarray(0, 16);
}

function cognitoTimestamp(now = new Date()): string {
  const weekday = WEEKDAYS[(now.getUTCDay() + 6) % 7];
  const month = MONTHS[now.getUTCMonth()];
  const day = String(now.getUTCDate());
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  const ss = String(now.getUTCSeconds()).padStart(2, "0");
  return `${weekday} ${month} ${day} ${hh}:${mm}:${ss} UTC ${now.getUTCFullYear()}`;
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex").padStart(64, "0");
}

function hexHash(hex: string): string {
  return sha256Hex(hexToBuf(hex));
}

function padHex(value: bigint | string): string {
  let hex = typeof value === "string" ? value : value.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  else if ("89ABCDEFabcdef".includes(hex[0] ?? "")) hex = `00${hex}`;
  return hex;
}

function hexToBuf(hex: string): Buffer {
  const even = hex.length % 2 === 0 ? hex : `0${hex}`;
  return Buffer.from(even, "hex");
}

function modPow(base: bigint, exp: bigint, modulus: bigint): bigint {
  let result = BigInt(1);
  let b = mod(base, modulus);
  let e = exp;
  while (e > BigInt(0)) {
    if (e & BigInt(1)) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= BigInt(1);
  }
  return result;
}

function mod(n: bigint, m: bigint): bigint {
  return ((n % m) + m) % m;
}
