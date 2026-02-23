import {
  Html,
  Head,
  Body,
  Container,
  Text,
  Heading,
} from '@react-email/components';
import { Tailwind } from '@react-email/tailwind';
import React from 'react';

interface PinResetOtpProps {
  otp: string;
  email: string;
  userName: string;
}

export const PinResetTemplate = ({ otp, userName }: PinResetOtpProps) => {
  return (
    <Tailwind>
      <Html>
        <Head>
          <title>PIN Reset OTP</title>
        </Head>
        <Body className="bg-gray-50 font-sans">
          <Container className="mx-auto max-w-md bg-white p-8 rounded-lg shadow-md">
            <Heading className="text-2xl font-bold text-gray-800 mb-4">
              Reset Your PIN
            </Heading>
            <Text className="text-gray-600 mb-4">Hello {userName},</Text>
            <Text className="text-gray-600 mb-6">
              We received a request to reset your PIN. Use the verification code
              below to complete the process:
            </Text>
            <div className="bg-blue-50 border border-blue-200 rounded-md p-6 mb-6 text-center">
              <Text className="text-3xl font-mono font-bold text-blue-800 tracking-widest">
                {otp}
              </Text>
            </div>
            <Text className="text-gray-600 mb-4">
              This code will expire in <strong>1 hour</strong>. If you didn't
              request a PIN reset, please ignore this email.
            </Text>
            <Text className="text-sm text-gray-500">
              If you cannot copy it, here is the code in plain text:{' '}
              <span className="font-mono font-bold">{otp}</span>
            </Text>
          </Container>
        </Body>
      </Html>
    </Tailwind>
  );
};
