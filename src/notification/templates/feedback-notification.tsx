import {
  Html,
  Head,
  Body,
  Container,
  Text,
  Heading,
  Section,
  Hr,
} from '@react-email/components';
import { Tailwind } from '@react-email/tailwind';
import React from 'react';

interface FeedbackNotificationProps {
  fullname: string;
  email: string;
  message: string;
  submittedAt: string;
}

export const FeedbackNotificationTemplate = ({
  fullname,
  email,
  message,
  submittedAt,
}: FeedbackNotificationProps) => {
  return (
    <Tailwind>
      <Html>
        <Head>
          <title>New Feedback Received - StoryTime</title>
        </Head>

        <Body className="bg-slate-50 font-sans px-2">
          <Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[20px] max-w-[520px] bg-white shadow-sm">
            <Section className="mt-[32px]">
              <Heading className="text-black text-[24px] font-normal text-left p-0 my-[30px] mx-0">
                New <strong>Feedback</strong> Received
              </Heading>

              <Text className="text-black text-[14px] leading-[24px]">
                A user has submitted feedback through the app.
              </Text>

              <Section className="mt-[24px] mb-[24px]">
                <div className="bg-gray-50 rounded border border-gray-200 p-4">
                  <Text className="text-gray-600 text-[12px] m-0 mb-1">
                    <strong>From:</strong>
                  </Text>
                  <Text className="text-black text-[14px] m-0 mb-4">
                    {fullname}
                  </Text>

                  <Text className="text-gray-600 text-[12px] m-0 mb-1">
                    <strong>Email:</strong>
                  </Text>
                  <Text className="text-black text-[14px] m-0 mb-4">
                    {email}
                  </Text>

                  <Text className="text-gray-600 text-[12px] m-0 mb-1">
                    <strong>Message:</strong>
                  </Text>
                  <div className="bg-white rounded border-l-4 border-l-[#4A90A4] p-4 mt-2">
                    <Text className="text-black text-[14px] m-0 whitespace-pre-wrap">
                      {message}
                    </Text>
                  </div>
                </div>
              </Section>

              <Hr className="border border-solid border-[#eaeaea] my-[26px] mx-0 w-full" />
              <Text className="text-[#666666] text-[12px] leading-[24px]">
                Submitted at: {submittedAt}
              </Text>
            </Section>
          </Container>
        </Body>
      </Html>
    </Tailwind>
  );
};
