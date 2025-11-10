import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as eks from "@pulumi/eks";
import * as k8s from "@pulumi/kubernetes";

// Get configuration
const config = new pulumi.Config();
const domain = config.get("domain") || "example.com";
const email = config.get("letsencryptEmail") || "admin@example.com";

// Get the default VPC
const defaultVpc = aws.ec2.getVpc({
    default: true,
});

// Get the default VPC subnets
const defaultVpcSubnets = defaultVpc.then(vpc => 
    aws.ec2.getSubnets({
        filters: [{
            name: "vpc-id",
            values: [vpc.id],
        }],
    })
);

// Create an EKS cluster with 3 t3.small nodes
const cluster = new eks.Cluster("eks-cluster", {
    vpcId: defaultVpc.then(vpc => vpc.id),
    subnetIds: defaultVpcSubnets.then(subnets => subnets.ids),
    instanceType: "t3.small",
    desiredCapacity: 3,
    minSize: 3,
    maxSize: 3,
    // Enable the cluster to use IAM roles for service accounts
    createOidcProvider: true,
});

// Create a Kubernetes provider instance using the cluster's kubeconfig
const k8sProvider = new k8s.Provider("k8s-provider", {
    kubeconfig: cluster.kubeconfig,
});

// Deploy NGINX Ingress Controller using Helm
const nginxIngress = new k8s.helm.v3.Release("nginx-ingress", {
    chart: "ingress-nginx",
    version: "4.11.3",
    repositoryOpts: {
        repo: "https://kubernetes.github.io/ingress-nginx",
    },
    namespace: "ingress-nginx",
    createNamespace: true,
    values: {
        controller: {
            service: {
                type: "LoadBalancer",
            },
            metrics: {
                enabled: true,
            },
        },
    },
}, { provider: k8sProvider });

// Deploy cert-manager for Let's Encrypt certificates
const certManager = new k8s.helm.v3.Release("cert-manager", {
    chart: "cert-manager",
    version: "v1.16.2",
    repositoryOpts: {
        repo: "https://charts.jetstack.io",
    },
    namespace: "cert-manager",
    createNamespace: true,
    values: {
        crds: {
            enabled: true,
        },
    },
}, { provider: k8sProvider });

// Create namespace for the application
const appNamespace = new k8s.core.v1.Namespace("app-namespace", {
    metadata: {
        name: "microservices-app",
    },
}, { provider: k8sProvider });

// Create Let's Encrypt ClusterIssuer
const letsencryptIssuer = new k8s.apiextensions.CustomResource("letsencrypt-issuer", {
    apiVersion: "cert-manager.io/v1",
    kind: "ClusterIssuer",
    metadata: {
        name: "letsencrypt-prod",
    },
    spec: {
        acme: {
            server: "https://acme-v02.api.letsencrypt.org/directory",
            email: email,
            privateKeySecretRef: {
                name: "letsencrypt-prod",
            },
            solvers: [{
                http01: {
                    ingress: {
                        class: "nginx",
                    },
                },
            }],
        },
    },
}, { provider: k8sProvider, dependsOn: [certManager] });

// Deploy Redis cache
const redisDeployment = new k8s.apps.v1.Deployment("redis", {
    metadata: {
        namespace: appNamespace.metadata.name,
        labels: { app: "redis" },
    },
    spec: {
        replicas: 1,
        selector: {
            matchLabels: { app: "redis" },
        },
        template: {
            metadata: {
                labels: { app: "redis" },
            },
            spec: {
                containers: [{
                    name: "redis",
                    image: "redis:7-alpine",
                    ports: [{
                        containerPort: 6379,
                    }],
                    resources: {
                        requests: {
                            cpu: "100m",
                            memory: "128Mi",
                        },
                        limits: {
                            cpu: "200m",
                            memory: "256Mi",
                        },
                    },
                }],
            },
        },
    },
}, { provider: k8sProvider });

// Create Redis Service
const redisService = new k8s.core.v1.Service("redis-service", {
    metadata: {
        namespace: appNamespace.metadata.name,
        name: "redis",
    },
    spec: {
        selector: { app: "redis" },
        ports: [{
            port: 6379,
            targetPort: 6379,
        }],
        type: "ClusterIP",
    },
}, { provider: k8sProvider });

// Deploy Node.js Backend API
const backendDeployment = new k8s.apps.v1.Deployment("backend", {
    metadata: {
        namespace: appNamespace.metadata.name,
        labels: { app: "backend" },
    },
    spec: {
        replicas: 2,
        selector: {
            matchLabels: { app: "backend" },
        },
        template: {
            metadata: {
                labels: { app: "backend" },
            },
            spec: {
                containers: [{
                    name: "backend",
                    // Using a sample Node.js API image - replace with your own
                    image: "hashicorp/http-echo:latest",
                    args: ["-text=Backend API v1.0"],
                    ports: [{
                        containerPort: 5678,
                    }],
                    env: [{
                        name: "REDIS_HOST",
                        value: "redis",
                    }, {
                        name: "REDIS_PORT",
                        value: "6379",
                    }],
                    resources: {
                        requests: {
                            cpu: "100m",
                            memory: "128Mi",
                        },
                        limits: {
                            cpu: "500m",
                            memory: "512Mi",
                        },
                    },
                }],
            },
        },
    },
}, { provider: k8sProvider });

// Create Backend Service
const backendService = new k8s.core.v1.Service("backend-service", {
    metadata: {
        namespace: appNamespace.metadata.name,
        name: "backend",
    },
    spec: {
        selector: { app: "backend" },
        ports: [{
            port: 80,
            targetPort: 5678,
        }],
        type: "ClusterIP",
    },
}, { provider: k8sProvider });

// Create Horizontal Pod Autoscaler for Backend with 70% CPU target
const backendHpa = new k8s.autoscaling.v2.HorizontalPodAutoscaler("backend-hpa", {
    metadata: {
        namespace: appNamespace.metadata.name,
        name: "backend-hpa",
    },
    spec: {
        scaleTargetRef: {
            apiVersion: "apps/v1",
            kind: "Deployment",
            name: backendDeployment.metadata.name,
        },
        minReplicas: 2,
        maxReplicas: 10,
        metrics: [{
            type: "Resource",
            resource: {
                name: "cpu",
                target: {
                    type: "Utilization",
                    averageUtilization: 70,
                },
            },
        }],
    },
}, { provider: k8sProvider });

// Deploy React Frontend
const frontendDeployment = new k8s.apps.v1.Deployment("frontend", {
    metadata: {
        namespace: appNamespace.metadata.name,
        labels: { app: "frontend" },
    },
    spec: {
        replicas: 2,
        selector: {
            matchLabels: { app: "frontend" },
        },
        template: {
            metadata: {
                labels: { app: "frontend" },
            },
            spec: {
                containers: [{
                    name: "frontend",
                    // Using nginx with a sample static page - replace with your React app
                    image: "nginx:alpine",
                    ports: [{
                        containerPort: 80,
                    }],
                    env: [{
                        name: "BACKEND_URL",
                        value: "http://backend",
                    }],
                    resources: {
                        requests: {
                            cpu: "50m",
                            memory: "64Mi",
                        },
                        limits: {
                            cpu: "200m",
                            memory: "256Mi",
                        },
                    },
                }],
            },
        },
    },
}, { provider: k8sProvider });

// Create Frontend Service
const frontendService = new k8s.core.v1.Service("frontend-service", {
    metadata: {
        namespace: appNamespace.metadata.name,
        name: "frontend",
    },
    spec: {
        selector: { app: "frontend" },
        ports: [{
            port: 80,
            targetPort: 80,
        }],
        type: "ClusterIP",
    },
}, { provider: k8sProvider });

// Create Ingress with HTTPS and Let's Encrypt
const appIngress = new k8s.networking.v1.Ingress("app-ingress", {
    metadata: {
        namespace: appNamespace.metadata.name,
        annotations: {
            "cert-manager.io/cluster-issuer": "letsencrypt-prod",
            "nginx.ingress.kubernetes.io/ssl-redirect": "true",
        },
    },
    spec: {
        ingressClassName: "nginx",
        tls: [{
            hosts: [domain],
            secretName: "app-tls-cert",
        }],
        rules: [{
            host: domain,
            http: {
                paths: [
                    {
                        path: "/api",
                        pathType: "Prefix",
                        backend: {
                            service: {
                                name: backendService.metadata.name,
                                port: {
                                    number: 80,
                                },
                            },
                        },
                    },
                    {
                        path: "/",
                        pathType: "Prefix",
                        backend: {
                            service: {
                                name: frontendService.metadata.name,
                                port: {
                                    number: 80,
                                },
                            },
                        },
                    },
                ],
            },
        }],
    },
}, { provider: k8sProvider, dependsOn: [nginxIngress, letsencryptIssuer] });

// Export the cluster's kubeconfig and important endpoints
export const kubeconfig = cluster.kubeconfig;
export const clusterName = cluster.eksCluster.name;
export const appUrl = pulumi.interpolate`https://${domain}`;
export const getLoadBalancerCommand = "kubectl get svc -n ingress-nginx ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'";
