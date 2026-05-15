# EasyMod Backend - Deployment Runbook

## Overview

This runbook provides step-by-step procedures for deploying, monitoring, and maintaining the EasyMod backend service.

## Emergency Contacts

- **Primary DevOps**: devops@easymod.tech
- **Secondary DevOps**: backup-devops@easymod.tech
- **On-Call Engineer**: oncall@easymod.tech
- **Product Manager**: pm@easymod.tech

## Service Information

- **Production URL**: https://easymod-backend-xxxxx-uc.a.run.app
- **Staging URL**: https://easymod-backend-staging-xxxxx-uc.a.run.app
- **GitHub Repository**: https://github.com/mr3826/EasyMod-backend
- **Monitoring Dashboard**: [Link to Grafana/Prometheus]

## Deployment Procedures

### Standard Deployment (Production)

**Trigger**: Automatic on merge to main branch
**Duration**: 15-20 minutes
**Downtime**: < 2 minutes (blue-green deployment)

#### Pre-Deployment Checklist
- [ ] Verify all tests pass in staging
- [ ] Check backup status (last 24 hours)
- [ ] Verify monitoring dashboards are green
- [ ] Notify stakeholders of deployment
- [ ] Check rate limiting configuration

#### Deployment Steps
1. **Code Merge**
   ```bash
   git checkout main
   git pull origin main
   ```

2. **Verify Staging**
   ```bash
   # Check staging deployment
   curl -f https://easymod-backend-staging-xxxxx-uc.a.run.app/health
   
   # Run smoke tests
   npm run test:staging-smoke
   ```

3. **Trigger Production Deployment**
   - Push to main branch (automatic)
   - Or manual trigger via GitHub Actions

4. **Monitor Deployment**
   - Watch GitHub Actions progress
   - Check deployment logs
   - Verify health endpoints

5. **Post-Deployment Verification**
   ```bash
   # Test production endpoints
   curl -f https://easymod-backend-xxxxx-uc.a.run.app/health
   curl -f https://easymod-backend-xxxxx-uc.a.run.app/health/database
   curl -f https://easymod-backend-xxxxx-uc.a.run.app/health/redis
   
   # Run smoke tests
   npm run test:production-smoke
   ```

6. **Update Monitoring**
   - Verify metrics are flowing
   - Check error rates
   - Update deployment tags

#### Rollback Procedure
**When to Rollback**:
- Error rate > 5%
- Response time > 2 seconds
- Service health checks failing
- Critical functionality broken

**Rollback Steps**:
1. **Emergency Rollback**
   ```bash
   # Trigger via GitHub Actions
   # Repository → Actions → Deploy Production Enhanced → Run workflow
   # Select rollback option
   ```

2. **Manual Rollback**
   ```bash
   # Get previous deployment tag
   git describe --tags --abbrev=0 HEAD~1
   
   # Rollback to previous version
   gcloud run deploy easymod-backend \
     --image=us-central1-docker.pkg.dev/gen-lang-client-0405487706/easymod-backend/app:PREVIOUS_TAG
   ```

3. **Verify Rollback**
   ```bash
   # Test rollbacked service
   curl -f https://easymod-backend-xxxxx-uc.a.run.app/health
   ```

### Staging Deployment

**Trigger**: Push to develop/staging branches
**Duration**: 10-15 minutes
**Downtime**: None

#### Staging Deployment Steps
1. **Code Push**
   ```bash
   git checkout develop
   git push origin develop
   ```

2. **Monitor Staging Deployment**
   - Check GitHub Actions progress
   - Verify staging URL accessibility

3. **Post-Deployment Testing**
   ```bash
   # Run integration tests
   npm run test:integration
   
   # Run feature tests
   npm run test:feature
   ```

## Incident Response

### Service Down Alert

**Severity**: Critical
**Response Time**: < 5 minutes

#### Immediate Actions (0-5 minutes)
1. **Acknowledge Alert**
   - Respond in Slack channel #alerts
   - Update incident status page

2. **Assess Impact**
   ```bash
   # Check service status
   curl -f https://easymod-backend-xxxxx-uc.a.run.app/health
   
   # Check recent deployments
   gh run list --workflow=deploy-production-enhanced
   
   # Check error rates
   # Check monitoring dashboard
   ```

3. **Initial Diagnosis**
   - Check GitHub Actions deployment logs
   - Review Cloud Run service logs
   - Check database connectivity
   - Check Redis connectivity

4. **Communication**
   - Update status page
   - Notify stakeholders
   - Post incident announcement

#### Investigation Steps (5-30 minutes)
1. **Log Analysis**
   ```bash
   # Get recent logs
   gcloud logs read "projects/gen-lang-client-0405487706/logs/easymod-backend" \
     --limit=50 \
     --format="json(timestamp,textPayload)"
   
   # Check for errors
   grep -i "error\|exception\|failed" logs.json
   ```

2. **Health Check Analysis**
   ```bash
   # Check all health endpoints
   for endpoint in health database redis memory cpu; do
     curl -f "https://easymod-backend-xxxxx-uc.a.run.app/health/$endpoint"
   done
   ```

3. **Resource Analysis**
   ```bash
   # Check Cloud Run service status
   gcloud run services describe easymod-backend \
     --region=us-central1 \
     --format="json(status,traffic)"
   
   # Check resource utilization
   gcloud run services describe easymod-backend \
     --region=us-central1 \
     --format="json(spec.template.spec.resources)"
   ```

#### Resolution Steps (30+ minutes)
1. **Quick Fix**
   - Restart service if needed
   - Rollback if recent deployment
   - Scale resources if resource exhaustion

2. **Full Recovery**
   - Restore from backup if data corruption
   - Rebuild and redeploy if needed
   - Scale up resources if load-related

3. **Verification**
   - Monitor service for 30 minutes post-fix
   - Run smoke tests
   - Update incident documentation

### Database Issues

#### Database Connection Lost
**Symptoms**:
- Database connection errors in logs
- Health check `/health/database` failing
- High error rates for database operations

**Immediate Actions**:
1. **Check Database Status**
   ```bash
   # Check Cloud SQL instance
   gcloud sql instances describe easymod-prod-db \
     --format="json(state,databaseVersion)"
   
   # Check connection logs
   gcloud sql instances logs list easymod-prod-db
   ```

2. **Verify Network Connectivity**
   ```bash
   # Test VPC connector
   gcloud compute vpc-connectors describe easymod-connector \
     --region=us-central1 \
     --format="json(state,ipCidrRange)"
   ```

3. **Restart Application**
   ```bash
   # Restart Cloud Run service
   gcloud run services update easymod-backend \
     --region=us-central1 \
     --update-env-vars="DB_RECONNECT=true"
   ```

#### Database Performance Issues
**Symptoms**:
- Slow query responses
- High database CPU usage
- Connection timeouts

**Diagnostic Commands**:
```bash
# Check slow queries
gcloud sql instances describe easymod-prod-db \
  --format="json(settings.databaseFlags)"

# Check connection count
psql -h [HOST] -U [USER] -d [DATABASE] -c "SELECT count(*) FROM pg_stat_activity;"

# Check table sizes
psql -h [HOST] -U [USER] -d [DATABASE] -c "
  SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname::regclass,tablename::regclass)) AS size
  FROM pg_tables 
  ORDER BY pg_total_relation_size(schemaname::regclass,tablename::regclass) DESC
  LIMIT 10;
"
```

## Backup and Recovery

### Automated Backup Status
**Schedule**: Daily at 2 AM UTC
**Retention**: 7 days
**Location**: Google Cloud Storage (easymod-backups)

#### Backup Verification
```bash
# Check latest backup
gsutil ls -l "gs://easymod-backups/database/" | head -5

# Verify backup integrity
gsutil stat "gs://easymod-backups/database/backup-latest.sql"
```

#### Manual Backup
```bash
# Trigger manual backup
gh workflow run backup-automation \
  -f backup_type=manual

# Monitor backup progress
gh run view [RUN_ID]
```

#### Database Restore
**When to Restore**:
- Data corruption detected
- Accidental data deletion
- Failed migration rollback

**Restore Procedure**:
1. **Select Backup**
   ```bash
   # List available backups
   gsutil ls "gs://easymod-backups/database/"
   
   # Choose backup based on timestamp
   ```

2. **Perform Restore**
   ```bash
   # Trigger restore via GitHub Actions
   gh workflow run backup-automation \
     -f backup_type=restore \
     -f backup_file=backup-2023-05-06T15-30-00-000Z.sql \
     -f confirmation=confirm
   ```

3. **Verify Restore**
   ```bash
   # Test database connectivity
   psql -h [HOST] -U [USER] -d [DATABASE] -c "SELECT 1;"
   
   # Verify data integrity
   # Run application smoke tests
   npm run test:production-smoke
   ```

## Performance Monitoring

### Key Metrics to Monitor

#### Application Metrics
- **Request Rate**: Target < 100 req/sec
- **Response Time**: Target < 200ms (p95)
- **Error Rate**: Target < 0.1%
- **Memory Usage**: Target < 800MB
- **CPU Usage**: Target < 70%

#### Database Metrics
- **Active Connections**: Target < 50
- **Query Duration**: Target < 100ms (p95)
- **Database CPU**: Target < 60%
- **Storage Usage**: Monitor growth

#### Redis Metrics
- **Operations/sec**: Monitor trends
- **Memory Usage**: Target < 70%
- **Connected Clients**: Monitor patterns

### Performance Investigation

#### High Response Time
```bash
# Check recent response times
curl -w "@json" -o /dev/null -s "https://easymod-backend-xxxxx-uc.a.run.app/api/health" | jq '.time_total'

# Check application logs for slow operations
gcloud logs read "projects/gen-lang-client-0405487706/logs/easymod-backend" \
  --limit=100 \
  --filter='jsonPayload.responseTime > 1000'
```

#### High Memory Usage
```bash
# Check memory usage
curl -f "https://easymod-backend-xxxxx-uc.a.run.app/health/memory" | jq '.memory.used'

# Check for memory leaks
gcloud logs read "projects/gen-lang-client-0405487706/logs/easymod-backend" \
  --limit=100 \
  --filter='jsonPayload.memory > 800000000'
```

## Security Incidents

### Security Alert Response

#### Suspicious Activity
**Immediate Actions**:
1. **Isolate Affected Systems**
   - Block suspicious IP addresses
   - Enable enhanced monitoring
   - Review recent access logs

2. **Assess Scope**
   - Check authentication logs
   - Review API access patterns
   - Verify data integrity

3. **Containment**
   - Rotate compromised credentials
   - Enable additional authentication factors
   - Audit recent changes

#### Security Investigation Commands
```bash
# Check recent authentication attempts
gcloud logging read "projects/gen-lang-client-0405487706/logs/easymod-backend" \
  --limit=100 \
  --filter='jsonPayload.event="auth_failure"'

# Check API access patterns
gcloud logging read "projects/gen-lang-client-0405487706/logs/easymod-backend" \
  --limit=100 \
  --filter='jsonPayload.path="/api/*"'

# Review recent deployments
gh run list --workflow=deploy-production-enhanced --limit=10
```

## Maintenance Procedures

### Scheduled Maintenance

#### Weekly Maintenance (Sundays 2-4 AM UTC)
1. **Pre-Maintenance**
   - Schedule maintenance window
   - Notify users of downtime
   - Create backup before maintenance

2. **Maintenance Tasks**
   - Update dependencies
   - Clean up old logs
   - Optimize database
   - Update security patches

3. **Post-Maintenance**
   - Verify service health
   - Monitor performance
   - Update documentation

#### Monthly Maintenance
1. **Security Updates**
   - Update Node.js runtime
   - Update container images
   - Review security advisories
   - Update dependencies

2. **Capacity Planning**
   - Review usage trends
   - Plan resource scaling
   - Update cost projections

## Communication Procedures

### Incident Communication

#### Initial Notification (0-15 minutes)
- **Slack**: #alerts channel
- **Email**: stakeholders@easymod.tech
- **Status Page**: status.easymod.tech

#### Status Updates (Every 30 minutes)
- Update incident severity
- Report investigation progress
- Provide ETA for resolution

#### Resolution Notification
- Post-mortem summary
- Root cause analysis
- Prevention measures

### Deployment Communication

#### Pre-Deployment (24 hours before)
- **Email**: stakeholders@easymod.tech
- **Slack**: #deployments channel
- **Content**: Deployment schedule and changes

#### Post-Deployment (Immediately after)
- **Email**: stakeholders@easymod.tech
- **Slack**: #deployments channel
- **Content**: Deployment completion and verification

## Escalation Procedures

### Escalation Levels

#### Level 1: On-Call Engineer (0-30 minutes)
- **Contact**: oncall@easymod.tech
- **Authority**: Restart services, rollback deployments
- **Escalation**: Level 2 after 30 minutes

#### Level 2: Senior DevOps (30-60 minutes)
- **Contact**: backup-devops@easymod.tech
- **Authority**: Major infrastructure changes, emergency fixes
- **Escalation**: Level 3 after 60 minutes

#### Level 3: Engineering Manager (60+ minutes)
- **Contact**: eng-manager@easymod.tech
- **Authority**: Critical decisions, external communication
- **Escalation**: CTO as needed

### Escalation Triggers
- Service down > 30 minutes
- Data loss or corruption
- Security breach confirmed
- Revenue impact > $1,000/hour

## Documentation Updates

### Runbook Maintenance
- **Monthly**: Review and update procedures
- **Quarterly**: Major updates and improvements
- **Incident-based**: After major incidents

### Change Log
- Document all procedure changes
- Include reasoning and effectiveness
- Review quarterly for improvements

## Training and Onboarding

### New Team Members
1. **Review this runbook**
2. **Shadow senior team members**
3. **Practice emergency procedures**
4. **Access credentials and tools**

### Ongoing Training
- **Monthly**: Incident response drills
- **Quarterly**: Major incident simulations
- **Annual**: Full procedure review

---

**Last Updated**: May 6, 2026  
**Version**: 1.0  
**Next Review**: June 6, 2026
