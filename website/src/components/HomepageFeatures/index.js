import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

const FeatureList = [
  {
    emoji: '🔌',
    title: 'Seamless NestJS Integration',
    description: 'Native decorators and dependency injection — no boilerplate glue code between NestJS and the Temporal SDK.',
  },
  {
    emoji: '🔍',
    title: 'Auto-Discovery',
    description: '@Activity() / @ActivityMethod() classes are found and registered automatically via the NestJS DiscoveryModule.',
  },
  {
    emoji: '🛡️',
    title: 'Type Safety',
    description: 'A typed workflow proxy (IWorkflowProxy<T>) infers start/signal/query args and return types from your workflow function.',
  },
  {
    emoji: '❤️',
    title: 'Health Monitoring',
    description: 'A built-in /health endpoint plus programmatic getHealth() and getStatistics() for production observability.',
  },
  {
    emoji: '🧩',
    title: 'Modular Architecture',
    description: 'Use client-only, worker-only, activity-only, schedules-only, or the full stack — pick what your service needs.',
  },
  {
    emoji: '🏭',
    title: 'Production Grade',
    description: 'Connection pooling, multi-worker support, graceful shutdown, and TLS for Temporal Cloud.',
  },
  {
    emoji: '🧪',
    title: 'Testing Utilities',
    description: 'Fakes for unit tests, an activity harness, a time-skipping test environment and history replay under nestjs-temporal-core/testing.',
  },
];

function Feature({ emoji, title, description }) {
  return (
    <div className={clsx('col col--4')}>
      <div className={styles.featureCard}>
        <div className={styles.featureEmoji} role="img" aria-hidden="true">
          {emoji}
        </div>
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures() {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props) => (
            <Feature key={props.title} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
