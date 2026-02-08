export interface ISpeechToTextProvider {
  name: string;
  transcribe(buffer: Buffer, mimetype: string): Promise<string>;
}

export interface TTSOptions {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
  speed?: string;
}

export interface ITextToSpeechProvider {
  name: string;
  generateAudio(
    text: string,
    voiceId?: string,
    model?: string,
    options?: TTSOptions,
  ): Promise<Buffer>;
}

export interface IVoiceCloningProvider {
  addVoice(name: string, fileBuffer: Buffer): Promise<string>;
}
