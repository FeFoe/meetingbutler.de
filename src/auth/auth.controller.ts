import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';

class RegisterDto {
  firstName: string;
  lastName: string;
  email: string;
}

@Controller('api/auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('register')
  async register(@Body() body: RegisterDto) {
    await this.auth.register(body.firstName, body.lastName, body.email);
    return { message: 'Bestätigungsmail gesendet. Bitte prüfe dein Postfach.' };
  }

  @Get('verify')
  async verify(@Query('token') token: string, @Res() res: Response) {
    const firstName = await this.auth.verify(token);
    return res.status(200).send(`<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Meetingbutler – E-Mail bestätigt</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap" rel="stylesheet"/>
  <style>
    body { font-family: 'Outfit', sans-serif; background: #f4f2ee; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #fff; border-radius: 16px; padding: 2.5rem 2rem; max-width: 420px; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,.07); }
    h1 { font-size: 1.5rem; color: #0b1120; margin-bottom: .75rem; }
    p { color: #6b7280; line-height: 1.6; margin-bottom: 1.25rem; }
    a { display: inline-block; background: #3b7eff; color: #fff; text-decoration: none; border-radius: 8px; padding: .75rem 1.5rem; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <h1>✅ E-Mail bestätigt, ${firstName}!</h1>
    <p>Du kannst jetzt E-Mails an <strong>meetings@meetingbutler.de</strong> weiterleiten und bekommst automatisch .ics-Kalendereinladungen zurück.</p>
    <a href="/">Zur Startseite</a>
  </div>
</body>
</html>`);
  }
}
