# EKS Microservices Application

This project provisions an Amazon EKS cluster with a complete microservices application stack including:

- **EKS Cluster**: 3 t3.small nodes in the default VPC
- **Microservices**:
  - React Frontend (nginx)
  - Node.js Backend API (with HPA at 70% CPU)
  - Redis Cache
- **Infrastructure**:
  - NGINX Ingress Controller
  - cert-manager for Let's Encrypt HTTPS certificates
  - Horizontal Pod Autoscaler for backend (2-10 replicas)

## Prerequisites

- AWS account with appropriate permissions
- Pulumi account
- Node.js 20+
- kubectl (optional, for cluster access)

## Configuration

Set the following configuration values:

```bash
pulumi config set aws:region us-west-2
pulumi config set domain your-domain.com
pulumi config set letsencryptEmail your-email@example.com
```

## GitHub Actions Setup

The project includes a CI/CD pipeline that:
- Runs `pulumi preview` on pull requests
- Runs `pulumi up` on pushes to main

### Required GitHub Secrets

1. **PULUMI_ACCESS_TOKEN**: Your Pulumi access token
   - Get it from: https://app.pulumi.com/account/tokens

2. **AWS_ROLE_ARN**: AWS IAM role ARN for OIDC authentication
   - Recommended: Use OIDC instead of long-lived credentials
   - See: https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services

## Deployment

### Local Deployment

```bash
# Install dependencies
npm install

# Initialize stack (if not already done)
pulumi stack init dev

# Configure AWS region and domain
pulumi config set aws:region us-west-2
pulumi config set domain your-domain.com
pulumi config set letsencryptEmail your-email@example.com

# Preview changes
pulumi preview

# Deploy
pulumi up
```

### Via GitHub Actions

1. Push code to a branch
2. Create a pull request to see preview
3. Merge to main to deploy

## Accessing the Application

After deployment:

1. Get the load balancer hostname:
   ```bash
   pulumi stack output ingressLoadBalancer
   ```

2. Point your domain DNS to the load balancer hostname (CNAME record)

3. Wait for Let's Encrypt certificate to be issued (usually 1-2 minutes)

4. Access your application at `https://your-domain.com`

## Application Architecture

```
Internet
    |
    v
NGINX Ingress (HTTPS via Let's Encrypt)
    |
    +-- / --> Frontend (React/nginx)
    |
    +-- /api --> Backend (Node.js)
                    |
                    v
                 Redis Cache
```

## Horizontal Pod Autoscaling

The backend API automatically scales between 2-10 replicas based on CPU utilization:
- Target: 70% CPU
- Min replicas: 2
- Max replicas: 10

## Customization

### Using Your Own Container Images

Replace the sample images in `index.ts`:

```typescript
// Frontend
image: "your-registry/frontend:tag"

// Backend
image: "your-registry/backend:tag"
```

### Adjusting Resources

Modify resource requests/limits in the deployment specs in `index.ts`.

## Cleanup

To destroy all resources:

```bash
pulumi destroy
```

## Outputs

- `kubeconfig`: Kubernetes configuration for cluster access
- `clusterName`: Name of the EKS cluster
- `ingressLoadBalancer`: Load balancer hostname/IP
- `appUrl`: Application URL (after DNS configuration)
