import nodemailer from 'nodemailer';
import type { Config } from './config.js';
export type Mailer = (email:string,purpose:'verify'|'reset',token:string)=>Promise<void>;
export function mailer(c:Config):Mailer{
 const transport=c.SMTP_HOST?nodemailer.createTransport({host:c.SMTP_HOST,port:c.SMTP_PORT,secure:c.SMTP_PORT===465,requireTLS:c.SMTP_PORT!==465,auth:c.SMTP_USER?{user:c.SMTP_USER,pass:c.SMTP_PASSWORD}:undefined,connectionTimeout:10000,socketTimeout:15000}):null;
 return async(email,purpose,token)=>{
  if(!transport)throw new Error('Email service not configured');
  const action=purpose==='verify'?'Verify your email':'Reset your password';
  await transport.sendMail({from:c.MAIL_FROM,to:email,subject:action+' — QuantPilot',text:action+' using this link:\n\n'+c.APP_ORIGIN+'/#'+purpose+'='+token+'\n\nThis link expires in 30 minutes and can be used once. If you did not request it, ignore this email.'});
 };
}

