import {
  Html,
  Head,
  Body,
  Container,
  Text,
  Heading,
  Section,
  Link,
  Hr,
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
          <title>Verify Your Email - StoryTime</title>
        </Head>

        <Body className="bg-slate-50 font-sans px-2">
          <Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[20px] max-w-[465px] bg-white shadow-sm">
            <Section className="mt-[32px]">
              <Heading className="text-black text-[24px] font-normal text-left p-0 my-[30px] mx-0">
                Verify your <strong>StoryTime</strong> account
              </Heading>

              <Text className="text-black text-[14px] leading-[24px]">
                Hello,
              </Text>
              <Text className="text-black text-[14px] leading-[24px]">
                You requested a verification code for <strong>{email}</strong>.
              </Text>

              <Section className="mt-[32px] mb-[32px]">
                <div className="bg-gray-50 rounded border border-gray-200 p-6 w-full">
                  <Text className="m-0 text-left text-3xl font-bold tracking-[0.25em] text-blue-600 font-mono">
                    {token}
                  </Text>
                </div>
              </Section>

              <Text className="text-black text-[14px] leading-[24px]">
                If you didn't request this, you can safely ignore this email.
              </Text>
              <Hr className="border border-solid border-[#eaeaea] my-[26px] mx-0 w-full" />
              <Text className="text-[#666666] text-[12px] leading-[24px]">
                This message was intended for {email}.
              </Text>
            </Section>
          </Container>
        </Body>
      </Html>
    </Tailwind>
  );
};
