export const google = {
  auth: {
    JWT: jest.fn().mockImplementation(() => ({})),
  },
  androidpublisher: jest.fn().mockReturnValue({
    purchases: {
      subscriptions: {
        get: jest.fn().mockResolvedValue({ data: {} }),
      },
    },
  }),
};
