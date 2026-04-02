import { useDebug } from '../context/DebugContext';

export default function DebugOnly({ children, fallback = null }) {
  const isDebug = useDebug();
  return isDebug ? children : fallback;
}
