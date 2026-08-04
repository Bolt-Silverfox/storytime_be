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

interface PasswordResetAlertProps {
    email: string;
    ipAddress: string;
    userAgent: string;
    timestamp: string;
    userName: string;
}

export const PasswordResetAlertTemplate = ({
    email,
    ipAddress,
    userAgent,
    timestamp,
    userName,
}: PasswordResetAlertProps) => {
    const date = new Date(timestamp).toLocaleDateString();
    const time = new Date(timestamp).toLocaleTimeString();

    return (
        <Tailwind>
            <Html>
                <Head>
                    <title>Password Reset Alert - StoryTime</title>
                </Head>

                <Body className="bg-slate-50 font-sans px-2">
                    <Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[20px] max-w-[465px] bg-white shadow-sm">
                        <Section className="mt-[32px]">
                            <Heading className="text-black text-[24px] font-normal text-left p-0 my-[30px] mx-0">
                                Password Reset Alert
                            </Heading>

                            <Text className="text-black text-[14px] leading-[24px]">
                                Dear {userName},
                            </Text>
                            <Text className="text-black text-[14px] leading-[24px]">
                                Your account was just accessed on a new device. If this was you,
                                no action is needed. However, if you don't recognize this
                                activity, kindly reset your password immediately.
                            </Text>

                            <Section className="mt-[32px] mb-[32px]">
                                <div className="bg-gray-50 rounded border border-gray-200 p-6 w-full">
                                    <Text className="m-0 text-left text-[14px] text-gray-700">
                                        <strong>IP Address:</strong> {ipAddress}
                                    </Text>
                                    <Text className="m-0 text-left text-[14px] text-gray-700 mt-2">
                                        <strong>Device:</strong> {userAgent}
                                    </Text>
                                    <Text className="m-0 text-left text-[14px] text-gray-700 mt-2">
                                        <strong>Date:</strong> {date}
                                    </Text>
                                    <Text className="m-0 text-left text-[14px] text-gray-700 mt-2">
                                        <strong>Time:</strong> {time}
                                    </Text>
                                </div>
                            </Section>

                            <Text className="text-black text-[14px] leading-[24px]">
                                If you didn't request this, please secure your account immediately.
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