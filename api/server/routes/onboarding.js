const express = require('express');
const { createOnboardingGateway, gatewayConfig, OnboardingServiceError } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const { requireJwtAuth } = require('~/server/middleware');
const { updateUser } = require('~/models');

const router = express.Router();
const gateway = createOnboardingGateway({ config: gatewayConfig });

router.use(requireJwtAuth);

/**
 * GET /api/onboarding/profile
 * Retrieves onboarding profile, available departments, and locking status.
 */
router.get('/profile', async (req, res) => {
  try {
    const profile = await gateway.getProfile(req);
    res.status(200).json(profile);
  } catch (error) {
    if (error instanceof OnboardingServiceError) {
      return res.status(error.status).json({ code: error.code, message: error.message });
    }
    logger.error('[onboarding] Failed to fetch onboarding profile:', error);
    res.status(503).json({ code: 'ONBOARDING_GATEWAY_ERROR', message: 'Unable to fetch onboarding profile' });
  }
});

/**
 * POST /api/onboarding/complete
 * Completes onboarding by selecting department. Atomically binds membership and activates grants.
 */
router.post('/complete', async (req, res) => {
  try {
    const result = await gateway.complete(req, req.body);
    const userId = req.user?.id || req.user?._id?.toString?.();
    if (userId) {
      const updatePayload = {
        onboardingCompleted: true,
        departmentId: result.department_id,
        departmentName: result.department_name,
        onboardingCompletedAt: new Date(),
      };
      if (typeof req.body?.name === 'string' && req.body.name.trim().length > 0) {
        updatePayload.name = req.body.name.trim();
      }
      await updateUser(userId, updatePayload);
      if (req.user) {
        req.user.onboardingCompleted = true;
        req.user.departmentId = result.department_id;
        req.user.departmentName = result.department_name;
        if (updatePayload.name) {
          req.user.name = updatePayload.name;
        }
      }
    }
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof OnboardingServiceError) {
      return res.status(error.status).json({ code: error.code, message: error.message });
    }
    logger.error('[onboarding] Failed to complete onboarding:', error);
    res.status(503).json({ code: 'ONBOARDING_SUBMIT_FAILED', message: 'Unable to complete onboarding' });
  }
});

module.exports = router;
