# Configuring AWS IAM for GitHub Actions with Pulumi ESC

## Issue

The ESC environment `aws-login/pulumi-dev-sandbox-env` uses AWS OIDC authentication with the IAM role:
```
arn:aws:iam::616138583583:role/pulumi-esc-oidc-test-org-ijh-AdministratorAccess-role
```

This role currently trusts Pulumi's OIDC provider but needs to also trust GitHub Actions OIDC provider.

## Solution

### Step 1: Add GitHub OIDC Provider to AWS (if not already added)

1. Go to AWS IAM Console → Identity providers
2. Check if `token.actions.githubusercontent.com` exists
3. If not, create it:
   - Provider type: OpenID Connect
   - Provider URL: `https://token.actions.githubusercontent.com`
   - Audience: `sts.amazonaws.com`

### Step 2: Update IAM Role Trust Policy

Add this statement to the trust policy of role `pulumi-esc-oidc-test-org-ijh-AdministratorAccess-role`:

```json
{
  "Effect": "Allow",
  "Principal": {
    "Federated": "arn:aws:iam::616138583583:oidc-provider/token.actions.githubusercontent.com"
  },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
    },
    "StringLike": {
      "token.actions.githubusercontent.com:sub": "repo:isaac-pulumi/eks-example:*"
    }
  }
}
```

### Step 3: Verify

After updating the trust policy, the GitHub Actions workflow will be able to use the ESC environment to authenticate with AWS.

## Alternative: Use Different ESC Environment

If you have an ESC environment already configured for GitHub Actions, update `Pulumi.dev.yaml`:

```yaml
environment:
  - your-github-actions-env
```

## Current Status

- ✅ Infrastructure deployed (42 resources)
- ✅ PULUMI_ACCESS_TOKEN configured
- ⚠️ AWS IAM trust policy needs update for GitHub Actions
