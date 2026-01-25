import {
  Html,
  Head,
  Body,
  Container,
  Text,
  Heading,
  Section,
  Hr,
  Preview,
} from '@react-email/components';
import { Tailwind } from '@react-email/tailwind';
import React from 'react';

interface AdminSupportTicketProps {
  userId: string;
  ticketId: string;
  subject: string;
  message: string;
  userEmail?: string;
}

export const AdminSupportTicketTemplate = ({
  userId,
  ticketId,
  subject,
  message,
  userEmail,
}: AdminSupportTicketProps) => {
  return (
    <Tailwind>
      <Html>
        <Head>
          <title>New Support Ticket</title>
        </Head>
        <Preview>New Support Ticket: {subject}</Preview>
        <Body className="bg-slate-50 font-sans px-2">
          <Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[20px] max-w-[465px] bg-white shadow-sm">
            <Section className="mt-[32px]">
              <Heading className="text-black text-[24px] font-normal text-left p-0 my-[30px] mx-0">
                New <strong>Support Ticket</strong>
              </Heading>

              <Text className="text-black text-[14px] leading-[24px]">
                <strong>User ID:</strong> {userId}
              </Text>
              {userEmail && (
                <Text className="text-black text-[14px] leading-[24px]">
                  <strong>User Email:</strong> {userEmail}
                </Text>
              )}
              <Text className="text-black text-[14px] leading-[24px]">
                <strong>Ticket ID:</strong> {ticketId}
              </Text>
              <Text className="text-black text-[14px] leading-[24px]">
                <strong>Subject:</strong> {subject}
              </Text>

              <Hr className="border border-solid border-[#eaeaea] my-[26px] mx-0 w-full" />

              <Text className="text-black text-[14px] leading-[24px] font-bold">
                Message:
              </Text>
              <Section className="bg-gray-50 rounded border border-gray-200 p-4 w-full">
                <Text className="text-black text-[14px] leading-[24px] whitespace-pre-wrap">
                  {message}
                </Text>
              </Section>
            </Section>
          </Container>
        </Body>
      </Html>
    </Tailwind>
  );
};
