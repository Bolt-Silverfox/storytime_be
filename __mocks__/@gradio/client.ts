export const Client = {
  connect: jest.fn().mockResolvedValue({
    predict: jest
      .fn()
      .mockResolvedValue({
        data: [{ url: 'https://mock.hf.space/audio.wav' }],
      }),
    close: jest.fn(),
  }),
};
