/**
 * The one thing another domain may ask GROWTH to do.
 *
 * USERS creates accounts; GROWTH owns where they came from. The two meet at
 * exactly one moment — the request that brought an account into existence — and
 * this is the whole of that meeting.
 *
 * It is deliberately one method that returns nothing. GROWTH cannot tell USERS
 * anything about an invitation, cannot report whether attribution happened, and
 * cannot fail the account creation it is called from: a person's signup must
 * not depend on a marketing fact being recordable, and a caller that could
 * branch on the answer would eventually branch on it in a way that made
 * somebody's account conditional on their referrer.
 *
 * The direction matters too. USERS depends on this interface and never on
 * GROWTH's tables, service, or repository, and GROWTH depends on nothing of
 * USERS' at all — it holds an opaque account identifier and cannot resolve it
 * to a person, a profile, or a name.
 */
export interface SignupAttributionPort {
  attributeSignup(input: {
    readonly acquisition:
      | {
          readonly campaign?: string | undefined;
          readonly content?: string | undefined;
          readonly inviteCode?: string | undefined;
          readonly medium?: string | undefined;
          readonly source?: string | undefined;
        }
      | undefined;
    readonly userId: string;
  }): Promise<void>;
}
