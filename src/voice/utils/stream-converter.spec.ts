import { Test, TestingModule } from '@nestjs/testing';
import { StreamConverter } from './stream-converter';
import { Readable } from 'stream';

describe('StreamConverter', () => {
  let converter: StreamConverter;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StreamConverter],
    }).compile();

    converter = module.get<StreamConverter>(StreamConverter);
  });

  it('should be defined', () => {
    expect(converter).toBeDefined();
  });

  it('should convert readable stream (Web API) to buffer', async () => {
    const inputData = new Uint8Array([1, 2, 3, 4, 5]);

    // Mock a readable stream
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(inputData);
        controller.close();
      },
    });

    const buffer = await converter.toBuffer(stream);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBe(5);
    expect(buffer[0]).toBe(1);
    expect(buffer[4]).toBe(5);
  });

  it('should convert readable stream (Node API) to buffer', async () => {
    const stream = Readable.from([Buffer.from([1, 2]), Buffer.from([3, 4, 5])]);

    const buffer = await converter.toBuffer(stream);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBe(5);
    expect(buffer[0]).toBe(1);
    expect(buffer[4]).toBe(5);
  });
});
