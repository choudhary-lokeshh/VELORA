/* eslint-disable no-restricted-imports -- This module is the approved SMTP submission adapter. It is the one place in the backend that owns a socket module, which is exactly what makes the rule enforceable everywhere else. See docs/security/06-abuse-outbound-networking.md. */
import * as netModule from 'node:net';
import * as tlsModule from 'node:tls';

/**
 * SMTP submission, as one narrow port.
 *
 * Backend source may not touch a socket module — ESLint and the boundary parser
 * enforce that across every workspace the runtime can import — and this file is
 * the single, reviewable exception for mail. It knows nothing about recovery,
 * about accounts, or about what a message says: a caller hands it a sender, a
 * recipient, and the exact bytes, and it either delivers them over an encrypted
 * transport or fails.
 *
 * Two properties are enforced here rather than left to configuration:
 *
 * - **The transport is encrypted or nothing is sent.** `smtps:` connects with
 *   implicit TLS; `smtp:` must complete a STARTTLS upgrade before this adapter
 *   authenticates or names a recipient. A permissive client would carry on in
 *   cleartext, and a recovery code on the wire is the whole account.
 * - **No value reaching a header may carry a line break.** The recipient is the
 *   one field in this path that comes from outside, and a carriage return there
 *   would let somebody add recipients to a message they do not own.
 *
 * Written directly rather than pulled in as a dependency, because the surface
 * needed is six commands and the alternative is a general-purpose mail library
 * inside the one flow that lets somebody back into an account they lost.
 */

const defaultTimeoutMilliseconds = 15_000;
const submissionPortForImplicitTls = 465;
const submissionPortForStartTls = 587;
/** A reply line is `NNN-text` for a continuation and `NNN text` for the last. */
const replyLinePattern = /^(\d{3})([ -])(.*)$/u;

/**
 * The socket surface this adapter actually uses, declared here rather than
 * imported.
 *
 * `apps/api` compiles against Bun's types rather than Node's, so the socket
 * modules resolve to declarations this project does not fully type. Naming the
 * seven methods that matter is both the honest fix and a useful one: it is a
 * written record of every primitive this exception depends on, and anything
 * beyond it would not compile.
 */
interface LineSocket {
  destroy(error?: Error): void;
  on(event: 'data', listener: (chunk: string) => void): void;
  on(event: 'close' | 'error', listener: (error: Error) => void): void;
  once(event: string, listener: (error: Error) => void): void;
  removeAllListeners(): void;
  removeListener(event: string, listener: (error: Error) => void): void;
  setEncoding(encoding: string): void;
  setTimeout(milliseconds: number, callback: () => void): void;
  write(data: string): void;
}

interface TcpModule {
  connect(options: {
    readonly host: string;
    readonly port: number;
  }): LineSocket;
}

interface TlsModule {
  connect(options: {
    readonly host?: string;
    readonly port?: number;
    readonly servername: string;
    readonly socket?: LineSocket;
  }): LineSocket;
}

const tcp = netModule as unknown as TcpModule;
const tls = tlsModule as unknown as TlsModule;

export interface SmtpSubmission {
  /** The exact message bytes, headers included, with CRLF line endings. */
  readonly message: string;
  readonly recipient: string;
  readonly sender: string;
}

export interface SmtpSubmissionPort {
  submit(submission: SmtpSubmission): Promise<void>;
}

export interface SmtpSubmissionOptions {
  /** `smtp://` or `smtps://`, optionally carrying credentials. */
  readonly submissionUrl: string;
  readonly timeoutMilliseconds?: number;
}

interface SmtpReply {
  readonly code: number;
  readonly lines: readonly string[];
}

function containsHeaderBreak(value: string): boolean {
  return /[\r\n]/u.test(value);
}

/**
 * A line-oriented SMTP conversation over one socket.
 *
 * The socket is replaceable because STARTTLS replaces it: the same conversation
 * continues over a new, encrypted one, and the buffer has to be dropped rather
 * than carried across, or a byte the server sent before the upgrade would be
 * read as part of what it sent after.
 */
class SmtpSession {
  private buffer = '';
  private pending:
    | { reject: (error: Error) => void; resolve: (reply: SmtpReply) => void }
    | undefined;
  private failure: Error | undefined;
  private lines: string[] = [];

  constructor(private socket: LineSocket) {
    this.attach();
  }

  private attach(): void {
    this.socket.setEncoding('utf8');
    this.socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    this.socket.on('error', (error: Error) => {
      this.fail(error);
    });
    this.socket.on('close', () => {
      this.fail(new Error('SMTP connection closed'));
    });
  }

  private fail(error: Error): void {
    this.failure ??= error;
    const pending = this.pending;
    this.pending = undefined;
    pending?.reject(error);
  }

  private drain(): void {
    for (;;) {
      const index = this.buffer.indexOf('\r\n');
      if (index === -1) return;
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 2);
      const match = replyLinePattern.exec(line);
      if (match === null) {
        this.fail(new Error('SMTP reply malformed'));
        return;
      }
      const [, code, separator, text] = match;
      this.lines.push(text ?? '');
      if (separator !== ' ') continue;
      const reply: SmtpReply = { code: Number(code), lines: this.lines };
      this.lines = [];
      const pending = this.pending;
      this.pending = undefined;
      pending?.resolve(reply);
    }
  }

  read(): Promise<SmtpReply> {
    if (this.failure !== undefined) return Promise.reject(this.failure);
    return new Promise<SmtpReply>((resolve, reject) => {
      this.pending = { reject, resolve };
      // A complete reply may already be buffered from an earlier chunk.
      this.drain();
    });
  }

  async command(line: string, expected: readonly number[]): Promise<SmtpReply> {
    this.socket.write(`${line}\r\n`);
    const reply = await this.read();
    if (!expected.includes(reply.code)) {
      throw new Error(`SMTP command refused with ${String(reply.code)}`);
    }
    return reply;
  }

  /** Replaces the socket after a STARTTLS upgrade. */
  adopt(socket: LineSocket): void {
    this.socket.removeAllListeners();
    this.buffer = '';
    this.lines = [];
    this.socket = socket;
    this.attach();
  }

  end(): void {
    this.socket.removeAllListeners();
    this.socket.destroy();
  }
}

export class TlsRequiredSmtpSubmission implements SmtpSubmissionPort {
  constructor(private readonly options: SmtpSubmissionOptions) {}

  async submit(submission: SmtpSubmission): Promise<void> {
    for (const value of [submission.sender, submission.recipient]) {
      if (containsHeaderBreak(value)) {
        throw new Error('SMTP address is not a single address');
      }
    }
    const url = new URL(this.options.submissionUrl);
    const implicitTls = url.protocol === 'smtps:';
    const port = Number(
      url.port !== ''
        ? url.port
        : implicitTls
          ? submissionPortForImplicitTls
          : submissionPortForStartTls,
    );
    const timeout =
      this.options.timeoutMilliseconds ?? defaultTimeoutMilliseconds;
    const host = url.hostname;

    const opened = implicitTls
      ? tls.connect({ host, port, servername: host })
      : tcp.connect({ host, port });
    // Bound the socket, not the variable: the STARTTLS upgrade replaces it, and
    // a timer closing over a reassignable reference would eventually destroy
    // the wrong one.
    guardTimeout(opened, timeout);
    let socket = opened;
    const session = new SmtpSession(socket);
    let encrypted = implicitTls;

    try {
      await waitForConnection(socket, implicitTls);
      const greeting = await session.read();
      if (greeting.code !== 220) throw new Error('SMTP greeting refused');

      const announced = senderDomain(submission.sender);
      await session.command(`EHLO ${announced}`, [250]);

      if (!encrypted) {
        // Required, not attempted. A submission endpoint that cannot upgrade is
        // one this adapter will not send anything over.
        await session.command('STARTTLS', [220]);
        const upgraded = tls.connect({ servername: host, socket });
        await waitForConnection(upgraded, true);
        guardTimeout(upgraded, timeout);
        session.adopt(upgraded);
        socket = upgraded;
        encrypted = true;
        await session.command(`EHLO ${announced}`, [250]);
      }

      const username = decodeURIComponent(url.username);
      const password = decodeURIComponent(url.password);
      if (username.length > 0) {
        const credential = Buffer.from(
          `\0${username}\0${password}`,
          'utf8',
        ).toString('base64');
        await session.command(`AUTH PLAIN ${credential}`, [235]);
      }

      await session.command(`MAIL FROM:<${submission.sender}>`, [250]);
      await session.command(`RCPT TO:<${submission.recipient}>`, [250, 251]);
      await session.command('DATA', [354]);
      await session.command(`${submission.message}\r\n.`, [250]);
      await session.command('QUIT', [221]).catch(() => undefined);
    } finally {
      session.end();
    }
  }
}

function guardTimeout(socket: LineSocket, milliseconds: number): void {
  socket.setTimeout(milliseconds, () => {
    socket.destroy(new Error('SMTP timed out'));
  });
}

function waitForConnection(socket: LineSocket, secure: boolean): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const event = secure ? 'secureConnect' : 'connect';
    const onError = (error: Error) => {
      socket.removeListener(event, onReady);
      reject(error);
    };
    const onReady = () => {
      socket.removeListener('error', onError);
      resolve();
    };
    socket.once(event, onReady);
    socket.once('error', onError);
  });
}

/**
 * The domain an EHLO announces, taken from the sender address.
 *
 * A submission client identifying itself is a formality most servers ignore,
 * but a value with a space or a line break in it is not a formality: it would
 * be a second command. The address is validated by configuration and again
 * above, so this only has to pick the right half of it.
 */
function senderDomain(senderAddress: string): string {
  const at = senderAddress.lastIndexOf('@');
  const domain = at === -1 ? '' : senderAddress.slice(at + 1);
  return domain.length > 0 ? domain : 'localhost';
}
