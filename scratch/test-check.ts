import { detectScaffoldOptions } from '../lib/detect-scaffold-options';

const prompt = 'I need a secure web application infrastructure on Google Cloud';
const interviewAnswers = `Does this setup match what you need: Google Cloud with Google Kubernetes Engine (GKE) and GitHub Actions, using Java as the minimal container runtime and MySQL
GitLab CI.
Where should we host it
europe-west1
Which environments do you need
Production only
Who should be able to access the API
Public HTTP on the default load-balancer hostname
How should MySQL be configured
Standard private database
How much traffic should we plan for
Medium — 3 to 5 app copies`;

const res = detectScaffoldOptions([prompt, interviewAnswers].join('\n'));
console.log('PRESETS:', res.presets);
console.log('ISSUES:', res.architectureSpec.issues);
