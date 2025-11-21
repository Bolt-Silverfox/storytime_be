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

interface EmailVerificationProps {
  token: string;
  email: string;
}

export const EmailVerificationTemplate = ({
  token,
  email,
}: EmailVerificationProps) => {
  return (
    <Tailwind>
      <Html>
        <Head>
          <title>Email Verification</title>
        </Head>
        <Body className="bg-gray-50 font-sans">
          <Container className="mx-auto max-w-md bg-white p-8 rounded-lg shadow-md">
            <Heading className="text-2xl font-bold text-gray-800 mb-4">
              Verify Your Email
            </Heading>
            <Text className="text-gray-600 mb-4">Hello,</Text>
            <Text className="text-gray-600 mb-6">
              Below is your Verification Token:
            </Text>
            <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-6">
              <Text className="text-xl font-mono font-bold text-blue-800 text-center">
                {token}
              </Text>
            </div>
            <Text className="text-sm text-gray-500">
              If you didn't request this, please ignore this email.
            </Text>
          </Container>
        </Body>
      </Html>
    </Tailwind>
  );
};
