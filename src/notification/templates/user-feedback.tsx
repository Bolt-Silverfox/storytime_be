import {
  Html,
  Head,
  Body,
  Container,
  Text,
  Heading,
  Section,
  Hr,
  Tailwind,
} from '@react-email/components';
import React from 'react';

interface UserFeedbackProps {
  userEmail: string;
  category: string;
  message: string;
  timestamp: string;
}

export const UserFeedbackTemplate = ({
  userEmail,
  category,
  message,
  timestamp,
}: UserFeedbackProps) => {
  return (
    <Tailwind>
      <Html>
        <Head>
          <title>New User Feedback - StoryTime</title>
        </Head>
        <Body className="bg-slate-50 font-sans px-2">
          <Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[20px] max-w-[465px] bg-white shadow-sm">
            <Section className="mt-[32px]">
              <Heading className="text-black text-[24px] font-normal text-left p-0 my-[30px] mx-0">
                New User Feedback
              </Heading>

              <Text className="text-black text-[14px] leading-[24px]">
                <strong>From:</strong> {userEmail}
              </Text>
              <Text className="text-black text-[14px] leading-[24px]">
                <strong>Category:</strong> {category}
              </Text>
              <Text className="text-black text-[14px] leading-[24px]">
                <strong>Time:</strong> {timestamp}
              </Text>

              <Hr className="border border-solid border-[#eaeaea] my-[26px] mx-0 w-full" />

              <Section className="mt-[32px] mb-[32px]">
                <div className="bg-gray-50 rounded border border-gray-200 p-6 w-full">
                  <Text className="m-0 text-left text-[16px] text-gray-800 whitespace-pre-wrap">
                    {message}
                  </Text>
                </div>
              </Section>

              <Hr className="border border-solid border-[#eaeaea] my-[26px] mx-0 w-full" />
              <Text className="text-[#666666] text-[12px] leading-[24px]">
                StoryTime Admin Notification
              </Text>
            </Section>
          </Container>
        </Body>
      </Html>
    </Tailwind>
  );
};
