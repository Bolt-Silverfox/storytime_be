import {
  Html,
  Head,
  Body,
  Container,
  Text,
  Heading,
  Section,
  Hr,
  Button,
} from '@react-email/components';
import { Tailwind } from '@react-email/tailwind';
import React from 'react';

interface PaymentFailedProps {
  email: string;
  userName: string;
  errorMessage?: string;
}

export const PaymentFailedTemplate = ({
  email,
  userName,
  errorMessage,
}: PaymentFailedProps) => {
  return (
    <Tailwind>
      <Html>
        <Head>
          <title>Payment Issue - StoryTime</title>
        </Head>

        <Body className="bg-slate-50 font-sans px-2">
          <Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[20px] max-w-[465px] bg-white shadow-sm">
            <Section className="mt-[32px]">
              <Heading className="text-black text-[24px] font-normal text-left p-0 my-[30px] mx-0">
                Payment Could Not Be Processed
              </Heading>

              <Text className="text-black text-[14px] leading-[24px]">
                Hi {userName},
              </Text>
              <Text className="text-black text-[14px] leading-[24px]">
                We were unable to process your recent payment for StoryTime.
              </Text>

              {errorMessage && (
                <Section className="bg-red-50 border border-red-200 rounded p-4 my-4">
                  <Text className="text-red-700 text-[13px] m-0">
                    <strong>Error:</strong> {errorMessage}
                  </Text>
                </Section>
              )}

              <Text className="text-black text-[14px] leading-[24px]">
                This could happen for a few reasons:
              </Text>

              <ul className="text-black text-[14px] leading-[24px] pl-6">
                <li>Insufficient funds</li>
                <li>Card expired or invalid</li>
                <li>Transaction declined by your bank</li>
                <li>Network connectivity issues</li>
              </ul>

              <Text className="text-black text-[14px] leading-[24px]">
                Please try again or use a different payment method. If the issue persists, contact your bank or our support team.
              </Text>

              <Section className="text-center mt-[32px] mb-[32px]">
                <Button
                  className="bg-[#6366f1] rounded text-white text-[14px] font-semibold no-underline text-center px-5 py-3"
                  href="storytime://subscription"
                >
                  Try Again
                </Button>
              </Section>

              <Hr className="border border-solid border-[#eaeaea] my-[26px] mx-0 w-full" />
              <Text className="text-[#666666] text-[12px] leading-[24px]">
                This message was sent to {email}. If you did not attempt to make a payment, please contact our support team immediately.
              </Text>
            </Section>
          </Container>
        </Body>
      </Html>
    </Tailwind>
  );
};
