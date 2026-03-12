export class EdgeTTS {
  synthesize = jest.fn().mockResolvedValue(undefined);
  toBuffer = jest.fn().mockReturnValue(Buffer.from('mock-audio'));
}
