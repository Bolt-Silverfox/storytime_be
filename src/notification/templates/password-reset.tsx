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

interface PasswordResetProps {
  resetToken: string;
  email: string;
}

export const PasswordResetTemplate = ({ resetToken }: PasswordResetProps) => {
  return (
    <Tailwind>
      <Html>
        <Head>
          <title>Password Reset</title>
        </Head>
        <Body className="bg-gray-50 font-sans">
          <Container className="mx-auto max-w-md bg-white p-8 rounded-lg shadow-md">
            <Heading className="text-2xl font-bold text-gray-800 mb-4">
              Reset Your Password
            </Heading>
            <Text className="text-gray-600 mb-4">Hello,</Text>
            <Text className="text-gray-600 mb-6">
              We received a request to reset your password. Use the token below
              to proceed:
            </Text>
            <div className="bg-red-50 border border-red-200 rounded-md p-6 mb-6 text-center">
              <Text className="text-2xl font-mono font-bold text-red-800 tracking-wider">
                {resetToken}
              </Text>
            </div>
            <Text className="text-gray-600 mb-4">
              This token will expire in 24 hours. If you didn't request a
              password reset, please ignore this email.
            </Text>
            <Text className="text-sm text-gray-500">
              If you cannot copy it, here is the token in plain text:
              <span className="font-mono font-bold">{resetToken}</span>
            </Text>
          </Container>
        </Body>
      </Html>
    </Tailwind>
  );
};
