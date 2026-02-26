import { Injectable } from '@nestjs/common';
import { Readable } from 'stream';

@Injectable()
export class StreamConverter {
  async toBuffer(
    stream: ReadableStream<Uint8Array> | Readable,
  ): Promise<Buffer> {
    if (this.isWebStream(stream)) {
      return this.webStreamToBuffer(stream);
    }
    return this.nodeStreamToBuffer(stream);
  }

  private isWebStream(
    stream: ReadableStream<Uint8Array> | Readable,
  ): stream is ReadableStream<Uint8Array> {
    return (
      typeof (stream as ReadableStream<Uint8Array>).getReader === 'function'
    );
  }

  private async webStreamToBuffer(
    stream: ReadableStream<Uint8Array>,
  ): Promise<Buffer> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return Buffer.from(result.buffer);
  }

  private async nodeStreamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
  }
}
