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

interface PasswordChangedProps {
    email: string;
    userName: string;
}

export const PasswordChangedTemplate = ({
    email,
    userName,
}: PasswordChangedProps) => {
    return (
        <Tailwind>
            <Html>
                <Head>
                    <title>Password Changed - StoryTime</title>
                </Head>

                <Body className="bg-slate-50 font-sans px-2">
                    <Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[20px] max-w-[465px] bg-white shadow-sm">
                        <Section className="mt-[32px]">
                            <Heading className="text-black text-[24px] font-normal text-left p-0 my-[30px] mx-0">
                                Password Changed Successfully
                            </Heading>

                            <Text className="text-black text-[14px] leading-[24px]">
                                Dear {userName},
                            </Text>
                            <Text className="text-black text-[14px] leading-[24px]">
                                Your password has been changed successfully. If this was you,
                                no action is needed.
                            </Text>
                            <Text className="text-black text-[14px] leading-[24px]">
                                If you did not make this change, please contact support immediately.
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
