import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ResetPasswordDto, ValidateResetTokenDto } from './auth.dto';

describe('reset code format on input', () => {
  const email = 'user@example.com';

  it.each(['123456', '000123', '12345678', '00123456'])(
    'accepts %s on validate-reset-token and reset-password',
    async (token) => {
      const validateDto = plainToInstance(ValidateResetTokenDto, {
        token,
        email,
      });
      const resetDto = plainToInstance(ResetPasswordDto, {
        token,
        email,
        newPassword: 'NewPassword1#',
      });

      expect(await validate(validateDto)).toHaveLength(0);
      expect(await validate(resetDto)).toHaveLength(0);
    },
  );
});
