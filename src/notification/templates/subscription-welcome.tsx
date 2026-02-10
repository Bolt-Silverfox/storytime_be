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

interface SubscriptionWelcomeProps {
  email: string;
  userName: string;
  planName: string;
}

export const SubscriptionWelcomeTemplate = ({
  email,
  userName,
  planName,
}: SubscriptionWelcomeProps) => {
  return (
    <Tailwind>
      <Html>
        <Head>
          <title>Welcome to Premium - StoryTime</title>
        </Head>

        <Body className="bg-slate-50 font-sans px-2">
          <Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[20px] max-w-[465px] bg-white shadow-sm">
            <Section className="mt-[32px]">
              <Heading className="text-black text-[24px] font-normal text-left p-0 my-[30px] mx-0">
                Welcome to StoryTime Premium!
              </Heading>

              <Text className="text-black text-[14px] leading-[24px]">
                Hi {userName},
              </Text>
              <Text className="text-black text-[14px] leading-[24px]">
                Thank you for subscribing to the <strong>{planName}</strong> plan! You now have access to all premium features.
              </Text>

              <Text className="text-black text-[14px] leading-[24px] font-semibold mt-4">
                What's included in your subscription:
              </Text>

              <ul className="text-black text-[14px] leading-[24px] pl-6">
                <li>Unlimited story access - Read as many stories as you want</li>
                <li>Unlimited voice generations - Create stories with any voice</li>
                <li>Premium voices - Access to all voice options</li>
                <li>AI story generation - Create personalized stories</li>
                <li>Ad-free experience - No interruptions</li>
                <li>Priority support - Get help when you need it</li>
              </ul>

              <Section className="text-center mt-[32px] mb-[32px]">
                <Button
                  className="bg-[#6366f1] rounded text-white text-[14px] font-semibold no-underline text-center px-5 py-3"
                  href="storytime://home"
                >
                  Start Exploring
                </Button>
              </Section>

              <Hr className="border border-solid border-[#eaeaea] my-[26px] mx-0 w-full" />
              <Text className="text-[#666666] text-[12px] leading-[24px]">
                This confirmation was sent to {email}. If you have any questions about your subscription, please contact our support team.
              </Text>
            </Section>
          </Container>
        </Body>
      </Html>
    </Tailwind>
  );
};
