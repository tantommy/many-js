import cbor from "cbor";
import { sha3_224 } from "js-sha3";
import { Address, Identity } from "../identity"
import { Key } from "../keys"
import { Message } from "../message";
import { CborData, CborMap, tag } from "./cbor";

export const ANONYMOUS = Buffer.from([0x00])
const EMPTY = Buffer.alloc(0);

export class CoseMessage {
  protectedHeader: CborMap;
  unprotectedHeader: CborMap;
  content: CborMap;
  signature: ArrayBuffer

  constructor(
    protectedHeader: CborMap,
    unprotectedHeader: CborMap,
    content: CborMap,
    signature: ArrayBuffer,
  ) {
    this.protectedHeader = protectedHeader;
    this.unprotectedHeader = unprotectedHeader;
    this.content = content;
    this.signature = signature;
  }

  static fromCborData(data: CborData): CoseMessage {
    const decoders = {
      tags: {
        10000: (value: Uint8Array) => new Address(Buffer.from(value)),
        1: (value: number) => tag(1, value),
      },
    };
    const cose = cbor.decodeFirstSync(data, decoders).value;
    const protectedHeader = cbor.decodeFirstSync(cose[0]);
    const unprotectedHeader = cose[1];
    const content = cbor.decodeFirstSync(cose[2], decoders).value;
    const signature = cose[3]

    return new CoseMessage(
      protectedHeader,
      unprotectedHeader,
      content,
      signature
    );
  }

  static async fromMessage(
    message: Message,
    identity?: Identity,
  ): Promise<CoseMessage> {
    const protectedHeader = this.getProtectedHeader(
      identity ? identity?.publicKey : ANONYMOUS,
    )
    const unprotectedHeader = this.getUnprotectedHeader()
    const content = message.content

    const signature = identity
      ? await this.getSignature(protectedHeader, content, identity)
      : EMPTY;
    return new CoseMessage(
      protectedHeader,
      unprotectedHeader,
      content,
      signature
    );
  }

  private static getProtectedHeader(publicKey: Key): CborMap {
    const coseKey = new CoseKey(publicKey);
    const protectedHeader = new Map();
    protectedHeader.set(1, -8); // alg: "Ed25519"
    protectedHeader.set(4, coseKey.keyId); // kid: kid
    protectedHeader.set("keyset", coseKey.toCborData());
    return protectedHeader;
  }

  private static getUnprotectedHeader(): CborMap {
    return new Map();
  }

  private static async getSignature(
    protectedHeader: CborMap,
    content: CborMap,
    identity: Identity,
  ): Promise<Buffer | ArrayBuffer> {
    const p = cbor.encodeCanonical(protectedHeader);
    const payload = cbor.encode(tag(10001, content));
    const message = cbor.encodeCanonical(["Signature1", p, EMPTY, payload]);
    return await identity.sign(message)
  }

  private replacer(key: string, value: any) {
    if (value?.type === "Buffer") {
      return Buffer.from(value.data).toString("hex");
    } else if (value instanceof Map) {
      return Object.fromEntries(value.entries());
    } else if (typeof value === "bigint") {
      return parseInt(value.toString());
    } else if (key === "hash") {
      return Buffer.from(value).toString("hex");
    } else {
      return value;
    }
  }

  toCborData(): CborData {
    const p = cbor.encodeCanonical(this.protectedHeader);
    const u = this.unprotectedHeader;
    const payload = cbor.encode(tag(10001, this.content));
    let sig = this.signature;
    return cbor.encodeCanonical(tag(18, [p, u, payload, sig]));
  }

  toString(): string {
    return JSON.stringify(
      [
        this.protectedHeader,
        this.unprotectedHeader,
        this.content,
        this.signature,
      ],
      this.replacer,
      2
    );
  }
}

export class CoseKey {
  key: CborMap;
  keyId: CborData;
  private common: CborMap;

  constructor(publicKey: Key) {
    this.common = this.getCommon(publicKey);
    this.keyId = this.getKeyId();
    this.key = this.getKey();
  }

  private getCommon(publicKey: Key) {
    const common = new Map();
    common.set(1, 1); // kty: OKP
    common.set(3, -8); // alg: EdDSA
    common.set(-1, 6); // crv: Ed25519
    common.set(4, [2]); // key_ops: [verify]
    common.set(-2, publicKey); // x: publicKey
    return common;
  }

  private getKeyId() {
    if (Buffer.compare(this.common.get(-2), ANONYMOUS) === 0) {
      return ANONYMOUS;
    }
    const keyId = new Map(this.common);
    const pk = "01" + sha3_224(cbor.encodeCanonical(keyId));
    return Buffer.from(pk, "hex");
  }

  private getKey() {
    const key = new Map(this.common);
    key.set(2, this.keyId); // kid: Key ID
    return key;
  }

  toCborData(): CborData {
    return cbor.encodeCanonical([this.key]);
  }

  toAddress(): Address {
    return new Address(this.keyId)
  }
}
