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

interface QuotaExhaustedProps {
  email: string;
  userName: string;
  quotaType: 'story' | 'voice';
  used: number;
  limit: number;
}

export const QuotaExhaustedTemplate = ({
  email,
  userName,
  quotaType,
  used,
  limit,
}: QuotaExhaustedProps) => {
  const quotaLabel = quotaType === 'story' ? 'stories' : 'voice generations';

  return (
    <Tailwind>
      <Html>
        <Head>
          <title>You've Reached Your Limit - StoryTime</title>
        </Head>

        <Body className="bg-slate-50 font-sans px-2">
          <Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[20px] max-w-[465px] bg-white shadow-sm">
            <Section className="mt-[32px]">
              <Heading className="text-black text-[24px] font-normal text-left p-0 my-[30px] mx-0">
                You've Reached Your Free Limit
              </Heading>

              <Text className="text-black text-[14px] leading-[24px]">
                Hi {userName},
              </Text>
              <Text className="text-black text-[14px] leading-[24px]">
                You've used all {limit} free {quotaLabel} for this period (
                {used}/{limit}).
              </Text>
              <Text className="text-black text-[14px] leading-[24px]">
                Upgrade to Premium for unlimited access to all stories and
                features:
              </Text>

              <ul className="text-black text-[14px] leading-[24px] pl-6">
                <li>Unlimited story access</li>
                <li>Unlimited voice generations</li>
                <li>All premium voices</li>
                <li>Ad-free experience</li>
              </ul>

              <Section className="text-center mt-[32px] mb-[32px]">
                <Button
                  className="bg-[#6366f1] rounded text-white text-[14px] font-semibold no-underline text-center px-5 py-3"
                  href="storytime://upgrade"
                >
                  Upgrade to Premium
                </Button>
              </Section>

              <Hr className="border border-solid border-[#eaeaea] my-[26px] mx-0 w-full" />
              <Text className="text-[#666666] text-[12px] leading-[24px]">
                This message was sent to {email}. Your free quota will reset at
                the start of the next period.
              </Text>
            </Section>
          </Container>
        </Body>
      </Html>
    </Tailwind>
  );
};
