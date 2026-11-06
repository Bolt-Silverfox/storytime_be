import {
  Html,
  Head,
  Body,
  Container,
  Text,
  Heading,
  Button,
} from '@react-email/components';
import { Tailwind } from '@react-email/tailwind';
import React from 'react';

interface PasswordlessLoginProps {
  code: string;
  linkUrl: string;
}

export const PasswordlessLoginTemplate = ({
  code,
  linkUrl,
}: PasswordlessLoginProps) => {
  return (
    <Tailwind>
      <Html>
        <Head>
          <title>Sign in to Storytime</title>
        </Head>
        <Body className="bg-gray-50 font-sans">
          <Container className="mx-auto max-w-md bg-white p-8 rounded-lg shadow-md">
            <Heading className="text-2xl font-bold text-gray-800 mb-4">
              Sign in to Storytime
            </Heading>
            <Text className="text-gray-600 mb-4">
              Use this code to sign in, or tap the button below.
            </Text>
            <div className="bg-gray-100 border border-gray-200 rounded-md p-6 mb-6 text-center">
              <Text className="text-3xl font-mono font-bold text-gray-800 tracking-widest">
                {code}
              </Text>
            </div>
            <div className="text-center mb-6">
              <Button
                href={linkUrl}
                className="bg-purple-600 text-white font-bold py-3 px-6 rounded-md"
              >
                Sign in to Storytime
              </Button>
            </div>
            <Text className="text-gray-600 mb-4">
              The code and the button work once and expire in 10 minutes. Enter
              the code only on the Storytime site or app.
            </Text>
            <Text className="text-sm text-gray-500">
              If you did not ask to sign in, ignore this email. Nobody can sign
              in without the code or the button.
            </Text>
          </Container>
        </Body>
      </Html>
    </Tailwind>
  );
};
