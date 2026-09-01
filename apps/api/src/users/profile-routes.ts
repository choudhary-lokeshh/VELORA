import {
  productErrorCodes,
  profileMediaReferenceRequestSchema,
  profileMediaUploadResponseSchema,
  profileResponseSchema,
  saveMatchingGenderRequestSchema,
  savePreferencesRequestSchema,
  saveProfileRequestSchema,
} from '@velora/validation';

import {
  parseRouteBody,
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import {
  requireConsumerAccount,
  type ConsumerContextResolver,
  type ConsumerRouteContext,
} from './context.js';
import {
  isProfileComplete,
  outstandingProfileRequirements,
} from './profile-repository.js';
import type {
  ProfileOutcome,
  ProfileService,
  ProfileView,
} from './profile-service.js';

export interface ProfileRoutesDependencies {
  readonly consumerContext: ConsumerContextResolver;
  readonly profiles: ProfileService;
}

/**
 * Consumer profile, preferences, and profile media over HTTP.
 *
 * Nothing in a request names an account, and the only identifier a request may
 * carry is a media identifier, which the repository resolves with ownership in
 * the predicate. A client therefore has no way to address an object that is not
 * already its own.
 */
export class ProfileRoutes {
  constructor(private readonly dependencies: ProfileRoutesDependencies) {}

  async getProfile(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const view = await this.dependencies.profiles.readProfile(
      resolved.context.account,
    );
    return { body: profileBody(view), status: 200 };
  }

  async saveProfile(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(saveProfileRequestSchema, input.body);
    if (!parsed.ok) {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }
    return this.render(
      await this.dependencies.profiles.saveProfile(resolved.context.account, {
        bio: parsed.value.bio,
        displayName: parsed.value.displayName,
        expectedVersion: parsed.value.expectedVersion,
        languages: parsed.value.languages,
      }),
      input.correlationId,
    );
  }

  async savePreferences(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(savePreferencesRequestSchema, input.body);
    if (!parsed.ok) {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }
    return this.render(
      await this.dependencies.profiles.savePreferences(
        resolved.context.account,
        {
          discoverable: parsed.value.discoverable,
          expectedVersion: parsed.value.expectedVersion,
        },
      ),
      input.correlationId,
    );
  }

  /**
   * Declares what the caller says about themselves for matching.
   *
   * The subject is the resolved consumer context and nothing in the body, so
   * there is no request this handler could accept that declares something about
   * somebody else. That is the whole of the authorization rule and it is
   * structural rather than checked.
   */
  async saveMatchingGender(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(saveMatchingGenderRequestSchema, input.body);
    if (!parsed.ok) {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }
    return this.render(
      await this.dependencies.profiles.saveMatchingGender(
        resolved.context.account,
        parsed.value.matchingGender,
      ),
      input.correlationId,
    );
  }

  async createMediaUpload(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    return this.render(
      await this.dependencies.profiles.createMediaUpload(
        resolved.context.account,
      ),
      input.correlationId,
    );
  }

  async completeMediaUpload(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(
      profileMediaReferenceRequestSchema,
      input.body,
    );
    if (!parsed.ok) {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }
    return this.render(
      await this.dependencies.profiles.completeMediaUpload(
        resolved.context.account,
        parsed.value.mediaId,
      ),
      input.correlationId,
    );
  }

  async removeMedia(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(
      profileMediaReferenceRequestSchema,
      input.body,
    );
    if (!parsed.ok) {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }
    return this.render(
      await this.dependencies.profiles.removeMedia(
        resolved.context.account,
        parsed.value.mediaId,
      ),
      input.correlationId,
    );
  }

  /** One mapping from domain outcome to status, used by every handler. */
  private render(outcome: ProfileOutcome, correlationId: string): RouteResult {
    switch (outcome.kind) {
      case 'saved': {
        return { body: profileBody(outcome.view), status: 200 };
      }
      case 'upload_created': {
        return {
          body: profileMediaUploadResponseSchema.parse({
            expiresAt: outcome.upload.expiresAt.toISOString(),
            maximumBytes: outcome.upload.maximumBytes,
            mediaId: outcome.mediaId,
            method: outcome.upload.method,
            uploadHeaders: outcome.upload.headers,
            uploadUrl: outcome.upload.url,
          }),
          status: 201,
        };
      }
      case 'conflict': {
        return routeFailure(409, productErrorCodes.conflict, correlationId);
      }
      case 'not_eligible': {
        return routeFailure(
          409,
          productErrorCodes.accountNotEligible,
          correlationId,
        );
      }
      case 'limit_reached': {
        return routeFailure(409, productErrorCodes.limitReached, correlationId);
      }
      case 'not_found': {
        return routeFailure(404, productErrorCodes.notFound, correlationId);
      }
      default: {
        // No approved storage provider. This is a truthful statement about the
        // environment, not a client error, and it must never be retried into a
        // success by pretending the object exists.
        return routeFailure(
          503,
          productErrorCodes.dependencyUnavailable,
          correlationId,
        );
      }
    }
  }

  private requireConsumer(input: RouteRequest): Promise<ConsumerRouteContext> {
    return requireConsumerAccount(this.dependencies.consumerContext, input);
  }
}

/**
 * The owner's view of their own profile. Storage keys, checksums, byte sizes,
 * and the storage adapter's name are all absent: they are the platform's record
 * of an object, not something the person who uploaded it needs or that any
 * client should be able to correlate.
 */
export function profileBody(
  view: ProfileView,
): ReturnType<typeof profileResponseSchema.parse> {
  return profileResponseSchema.parse({
    ...(view.profile?.bio == null ? {} : { bio: view.profile.bio }),
    complete: isProfileComplete(view.completeness),
    discoverable: view.discoverable,
    ...(view.profile === undefined
      ? {}
      : { displayName: view.profile.displayName }),
    languages: [...view.languages],
    // Present only when the person has actually declared something. An absent
    // field is "never asked"; `undisclosed` is "asked and declined".
    ...(view.matchingGender === undefined
      ? {}
      : { matchingGender: view.matchingGender }),
    media: view.media.map((media) => ({
      id: media.id,
      position: media.position,
      ...(media.rejectionReason === undefined
        ? {}
        : { rejectionReason: media.rejectionReason }),
      state: media.state,
      // Present only while a window is open. Once bytes have arrived there is
      // no deadline left to show.
      ...(media.uploadExpiresAt === undefined
        ? {}
        : { uploadExpiresAt: media.uploadExpiresAt.toISOString() }),
    })),
    outstandingRequirements: [
      ...outstandingProfileRequirements(view.completeness),
    ],
    ...(view.preferencesVersion === undefined
      ? {}
      : { preferencesVersion: view.preferencesVersion }),
    ...(view.account.region === null ? {} : { region: view.account.region }),
    ...(view.profile === undefined ? {} : { version: view.profile.version }),
  });
}
