
export interface ISpeechToTextProvider {
    name: string;
    transcribe(buffer: Buffer, mimetype: string): Promise<string>;
}

export interface ITextToSpeechProvider {
    name: string;
    generateAudio(text: string, voiceId?: string, model?: string, options?: any): Promise<Buffer>;
}

export interface IVoiceCloningProvider {
    addVoice(name: string, fileBuffer: Buffer): Promise<string>;
}
